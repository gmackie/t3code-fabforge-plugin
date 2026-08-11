import { createFabForgeClient, type FabForgeSnapshot, type FabForgeWorkflowState } from "./fabforge.ts";
import { createRpcHandler } from "./rpc.ts";

let snapshot = JSON.parse(process.env.T3_PLUGIN_SNAPSHOT ?? '{"projects":[],"kitRuns":[]}') as FabForgeSnapshot;
const statePath = process.env.T3_PLUGIN_STATE_FILE;
let workflowState: FabForgeWorkflowState = {};
if (statePath) {
  try {
    const stored = JSON.parse(await Bun.file(statePath).text()) as { workflowState?: FabForgeWorkflowState };
    workflowState = stored.workflowState ?? {};
  } catch {
    // Missing or invalid state starts safely unapproved.
  }
}
const client = process.env.T3_PLUGIN_ENDPOINT && process.env.T3_PLUGIN_TOKEN && process.env.T3_PLUGIN_WORKSPACE
  ? createFabForgeClient({ endpoint: process.env.T3_PLUGIN_ENDPOINT, token: process.env.T3_PLUGIN_TOKEN, workspaceId: process.env.T3_PLUGIN_WORKSPACE })
  : null;
const executePrefix = process.env.T3_PLUGIN_EXECUTE_COMMAND?.trim().split(/\s+/u).filter(Boolean) ?? [];
const verifyPrefix = process.env.T3_PLUGIN_VERIFY_COMMAND?.trim().split(/\s+/u).filter(Boolean) ?? [];
const runCommand = async (prefix: readonly string[], args: readonly string[]) => {
  if (prefix.length === 0) return "";
  const child = Bun.spawn([...prefix, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(stderr.trim() || `FabForge command exited with ${exitCode}`);
  return stdout;
};
const refresh = async () => { if (client) snapshot = await client.snapshot(); return snapshot; };
const handler = createRpcHandler({
  get snapshot() { return snapshot; },
  refresh,
  getWorkflowState: () => workflowState,
  saveWorkflowState: async (next: FabForgeWorkflowState) => {
    workflowState = { approved: next.approved === true, ...(next.jobId ? { jobId: next.jobId } : {}), executionRequested: next.executionRequested === true, ...(next.verificationStatus ? { verificationStatus: next.verificationStatus } : {}) };
    if (statePath) await Bun.write(statePath, JSON.stringify({ workflowState }));
  },
  executeJob: async (input) => {
    if (executePrefix.length > 0) {
      const output = await runCommand(executePrefix, ["--job-id", input.jobId, "--process", input.process, ...(input.machineId ? ["--machine-id", input.machineId] : [])]);
      return { status: "accepted" as const, ...(output.trim() ? { reference: output.trim() } : {}) };
    }
    if (!client) throw new Error("FabForge endpoint or execute command is not configured");
    return client.executeJob(input);
  },
  verifyArtifact: async (input) => {
    if (verifyPrefix.length > 0) {
      await runCommand(verifyPrefix, ["--job-id", input.jobId, "--artifact", input.artifactPath, "--expected", input.expectedKinds.join(",")]);
      return { status: "passed" as const };
    }
    if (!client) throw new Error("FabForge endpoint or verify command is not configured");
    const result = await client.verifyArtifact(input) as { status?: string; verification?: string; detail?: string };
    return { status: result.status === "failed" || result.verification === "failed" ? "failed" as const : "passed" as const, ...(result.detail ? { detail: result.detail } : {}) };
  },
});
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line) as { requestId: string; method: string; payload?: { navigationId?: string; panelId?: string; actionId?: string } };
      void handler(request.method, request.payload).then((result) => process.stdout.write(`${JSON.stringify({ type: "plugin.response", requestId: request.requestId, ...result })}\n`));
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ type: "plugin.response", requestId: "unknown", ok: false, error: error instanceof Error ? error.message : "invalid request" })}\n`);
    }
  }
});
