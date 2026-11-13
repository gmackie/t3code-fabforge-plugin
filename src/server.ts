import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { loadConfig, statePath, type FabForgeConfig } from "./config.ts";
import {
  buildJobVerification,
  buildManufacturingWorkflow,
  buildProcessControl,
  createFabForgeClient,
  validateExecutionTarget,
  verificationOutcome,
  type FabForgeJob,
  type FabForgeSnapshot,
} from "./fabforge.ts";
import { SECTIONS, SECTION_TITLES, sectionGroups, sectionMetrics, type Section } from "./sections.ts";
import { sqliteWorkflowStore, type WorkflowStore } from "./state.ts";
import { VIEWS, viewHtml, type ViewName } from "./views/html.ts";
import type { JobReviewData, WorkspaceData } from "./views/render.ts";

export const SERVER_INFO = { name: "fabforge", version: "0.4.0" } as const;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FabForgeServerOptions = {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  timeoutMs?: number;
  store?: WorkflowStore;
  commandTimeoutMs?: number;
};

export const COMMAND_TIMEOUT_MS = 120_000;

const jobId = z.string().min(1).max(256).describe("FabForge job id");

export function createFabForgeMcpServer(options: FabForgeServerOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "FabForge is a manufacturing IDE for 3D printing, laser/plasma cutting and CNC. Use fabforge_workspace to read projects, jobs, machines, materials, kit runs and evidence, and fabforge_job_review to review one job. A human must approve a job in the job review view before fabforge_job_execute sends it to a machine; fabforge_artifact_verify then checks its output.",
  });
  const env = () => options.env ?? process.env;
  const store = options.store ?? sqliteWorkflowStore(statePath(env()));

  // Config is read per call so a misconfigured plugin still starts and every
  // tool explains which setting is missing.
  function connect() {
    const config = loadConfig(env());
    const client = createFabForgeClient({ endpoint: config.endpoint, token: config.token, workspaceId: config.workspaceId, ...(options.fetch ? { fetchImpl: options.fetch } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
    return { config, client };
  }

  async function review(config: FabForgeConfig, snapshot: FabForgeSnapshot, requestedJobId?: string): Promise<JobReviewData> {
    const jobs = snapshot.jobs ?? [];
    const job = requestedJobId ? jobs.find((candidate) => candidate.id === requestedJobId) : jobs[0];
    if (requestedJobId && !job) throw new Error(`FabForge job ${requestedJobId} was not found in workspace "${config.workspaceId}"`);
    const base = {
      workspaceId: config.workspaceId,
      verification: buildJobVerification(snapshot),
      jobs: jobs.map((candidate) => ({ ...candidate, control: buildProcessControl(candidate) })),
      artifacts: snapshot.artifacts ?? [],
      pollSeconds: config.pollSeconds,
      refreshedAt: new Date().toISOString(),
    };
    if (!job) return base;
    const state = await store.get(config.workspaceId, job.id);
    return {
      ...base,
      jobId: job.id,
      state,
      machines: (snapshot.machines ?? []).filter((machine) => machine.process.toLowerCase() === job.process.toLowerCase()),
      // The workflow is about this one job, not every job in the workspace.
      workflow: buildManufacturingWorkflow({ ...snapshot, jobs: [job] }, { ...state, jobId: job.id }),
    };
  }

  const findJob = (snapshot: FabForgeSnapshot, config: FabForgeConfig, id: string): FabForgeJob => {
    const job = (snapshot.jobs ?? []).find((candidate) => candidate.id === id);
    if (!job) throw new Error(`FabForge job ${id} was not found in workspace "${config.workspaceId}"`);
    return job;
  };

  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(name), _meta: { ui: { prefersBorder: true } } }],
    }));
  }

  registerAppTool(
    server,
    "fabforge_workspace",
    {
      title: "FabForge workspace",
      description:
        "Read the FabForge workspace: projects, kit runs, manufacturing jobs, machines, materials and artifact evidence. `section` narrows it to one area (e.g. laser, cnc, machines, kit-runs). Renders the FabForge workspace view.",
      inputSchema: z.object({ section: z.enum(SECTIONS).optional().describe("Workspace area; defaults to overview") }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.workspace.uri, visibility: ["model", "app"] } },
    },
    async ({ section }) =>
      result(async () => {
        const { config, client } = connect();
        const snapshot = await client.snapshot();
        const current: Section = section ?? "overview";
        const data: WorkspaceData = { workspaceId: config.workspaceId, section: current, snapshot, pollSeconds: config.pollSeconds, refreshedAt: new Date().toISOString() };
        const metrics = sectionMetrics(snapshot).map((metric) => `${metric.title}: ${metric.value}`).join(", ");
        const groups = sectionGroups(snapshot, current).map(
          (group) => `${group.title} (${group.items.length}):\n${group.items.map((item) => `- ${item.id}${item.title !== item.id ? ` ${item.title}` : ""}${item.status ? ` [${item.status}]` : ""}${item.detail ? ` ${item.detail}` : ""}`).join("\n") || "- none"}`,
        );
        return { data, text: `FabForge ${SECTION_TITLES[current]} for workspace ${config.workspaceId}. ${metrics}.\n${groups.join("\n")}` };
      }),
  );

  registerAppTool(
    server,
    "fabforge_job_review",
    {
      title: "FabForge job review",
      description:
        "Review a FabForge manufacturing job before it runs: process control, expected artifacts, compatible machines, approval/execution/verification state and the next action, plus the workspace's job verification roll-up. Defaults to the first job. Renders the job review view, where a human approves execution.",
      inputSchema: z.object({ jobId: jobId.optional() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.jobReview.uri, visibility: ["model", "app"] } },
    },
    async ({ jobId: id }) =>
      result(async () => {
        const { config, client } = connect();
        const data = await review(config, await client.snapshot(), id);
        return { data, text: reviewText(data) };
      }),
  );

  // App-only: an agent cannot approve its own machine execution; T3 hides
  // this tool from the model and only lets the view call it.
  server.registerTool(
    "fabforge_job_approve",
    {
      title: "Approve FabForge job",
      description: "Record a human's approval to send a FabForge job to a machine.",
      inputSchema: z.object({ jobId }),
      annotations: { idempotentHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ jobId: id }) =>
      result(async () => {
        const { config, client } = connect();
        const snapshot = await client.snapshot();
        findJob(snapshot, config, id);
        // A fresh approval restarts the review for this job.
        await store.save(config.workspaceId, id, { approved: true, executionRequested: false });
        const data = await review(config, snapshot, id);
        return { data, text: `FabForge job ${id} approved for execution.` };
      }),
  );

  registerAppTool(
    server,
    "fabforge_job_execute",
    {
      title: "Execute FabForge job",
      description:
        "Send an approved FabForge job to a machine. Fails unless a human approved the job in the job review, and unless the machine runs the job's process and is online, idle or ready. Uses FABFORGE_EXECUTE_COMMAND when set, otherwise FabForge's execute API.",
      inputSchema: z.object({ jobId, machineId: z.string().min(1).max(256).optional().describe("Machine id; defaults to the job's assigned machine") }),
      annotations: { openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.jobReview.uri, visibility: ["model", "app"] } },
    },
    async ({ jobId: id, machineId }) =>
      result(async () => {
        const { config, client } = connect();
        const snapshot = await client.snapshot();
        const job = findJob(snapshot, config, id);
        const state = await store.get(config.workspaceId, id);
        if (!state.approved) throw new Error(`Approve FabForge job ${id} in the job review before execution`);
        const target = machineId ?? job.machineId;
        if (!target) throw new Error(`Select a machine for FabForge job ${id} before execution`);
        const machine = (snapshot.machines ?? []).find((candidate) => candidate.id === target);
        if (!machine) throw new Error(`Machine ${target} is not in workspace "${config.workspaceId}"`);
        const validation = validateExecutionTarget(job, machine);
        if (!validation.ok) throw new Error(validation.reason);

        let execution: { status: string; reference?: string };
        if (config.executeCommand.length) {
          const run = await runCommand(config.executeCommand, ["--job-id", job.id, "--process", job.process, "--machine-id", machine.id], options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS);
          if (run.exitCode !== 0) throw new Error(`FABFORGE_EXECUTE_COMMAND failed (exit ${run.exitCode})${run.stderr ? `: ${run.stderr}` : ""}`);
          execution = { status: "accepted", ...(run.stdout ? { reference: run.stdout } : {}) };
        } else {
          const response = ((await client.executeJob({ jobId: job.id, process: job.process, machineId: machine.id })) ?? {}) as { status?: unknown; id?: unknown; reference?: unknown };
          const reference = typeof response.reference === "string" ? response.reference : typeof response.id === "string" ? response.id : undefined;
          execution = { status: response.status === "completed" ? "completed" : "accepted", ...(reference ? { reference } : {}) };
        }
        await store.save(config.workspaceId, id, { approved: true, executionRequested: true });
        const data = { ...(await review(config, await client.snapshot().catch(() => snapshot), id)), execution };
        return { data, text: `FabForge job ${id} ${execution.status} on machine ${machine.id}${execution.reference ? ` (reference ${execution.reference})` : ""}.` };
      }),
  );

  registerAppTool(
    server,
    "fabforge_artifact_verify",
    {
      title: "Verify FabForge artifact",
      description:
        "Verify the output artifact of an executed FabForge job (G-code/NC for printing and CNC, SVG/DXF for laser, DXF for plasma). Uses FABFORGE_VERIFY_COMMAND when set, otherwise FabForge's verify API, and records passed, failed or pending.",
      inputSchema: z.object({ jobId, artifactPath: z.string().min(1).max(1024).describe("Artifact path, e.g. out/part.gcode") }),
      annotations: { openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.jobReview.uri, visibility: ["model", "app"] } },
    },
    async ({ jobId: id, artifactPath }) =>
      result(async () => {
        const { config, client } = connect();
        const snapshot = await client.snapshot();
        const job = findJob(snapshot, config, id);
        const state = await store.get(config.workspaceId, id);
        if (!state.executionRequested) throw new Error(`Execute FabForge job ${id} before verifying its artifact`);
        const expectedKinds = buildProcessControl(job).artifactKinds;

        let outcome: { status: "passed" | "failed" | "pending"; detail?: string };
        if (config.verifyCommand.length) {
          // A non-zero exit is a failed verification, reported with its stderr.
          const run = await runCommand(config.verifyCommand, ["--job-id", job.id, "--artifact", artifactPath, "--expected", expectedKinds.join(",")], options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS);
          outcome = run.exitCode === 0 ? { status: "passed", ...(run.stdout ? { detail: run.stdout } : {}) } : { status: "failed", detail: run.stderr || `exit ${run.exitCode}` };
        } else {
          outcome = verificationOutcome(await client.verifyArtifact({ jobId: job.id, artifactPath, expectedKinds }));
        }
        await store.save(config.workspaceId, id, { ...state, verificationStatus: outcome.status });
        const data = { ...(await review(config, await client.snapshot().catch(() => snapshot), id)), verificationResult: { artifactPath, ...outcome } };
        return { data, text: `FabForge verification of ${artifactPath} for job ${id}: ${outcome.status}${outcome.detail ? ` (${outcome.detail})` : ""}.` };
      }),
  );

  return server;
}

function reviewText(data: JobReviewData): string {
  const header = `FabForge job verification for workspace ${data.workspaceId}: ${data.verification.status}, ${data.verification.summary}.`;
  if (!data.jobId || !data.workflow) return `${header}\nNo manufacturing jobs to review.`;
  const job = data.jobs.find((candidate) => candidate.id === data.jobId)!;
  const steps = data.workflow.steps.map((step) => `- ${step.title}: ${step.state}${step.detail ? ` (${step.detail})` : ""}`).join("\n");
  const machines = data.machines?.map((machine) => `${machine.id} [${machine.status}]`).join(", ") || "none";
  const next = data.workflow.actions?.[0]?.title ?? "none";
  return `${header}\nJob ${job.id}: ${job.process} [${job.status}], ${job.control.action}, expects ${job.control.artifactKinds.join("/") || "operator evidence"}. Compatible machines: ${machines}.\nStage ${data.workflow.currentStage}, next action: ${next}${next.startsWith("Approve") ? " (a human approves in the job review view)" : ""}.\n${steps}`;
}

async function runCommand(prefix: readonly string[], args: readonly string[], timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn([...prefix, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  } catch {
    throw new Error(`Could not start ${prefix[0]}; check the FabForge command setting`);
  }
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
  if (child.signalCode) throw new Error(`${prefix[0]} did not finish within ${Math.ceil(timeoutMs / 1000)}s`);
  return { exitCode, stdout: stdout.trim().slice(0, 500), stderr: stderr.trim().split("\n")[0]!.slice(0, 200) };
}

async function result(run: () => Promise<{ data: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { data, text } = await run();
    return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}
