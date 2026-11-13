import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { sqliteWorkflowStore } from "./state.ts";
import { connectedClient, env, fakeFabForge, type FakeFabForge } from "./testing.ts";
import type { JobReviewData, WorkspaceData } from "./views/render.ts";

type Structured<T> = { structuredContent?: T; isError?: boolean; content: { type: string; text?: string }[] };
type TestClient = Awaited<ReturnType<typeof connectedClient>>["client"];
const call = async <T = JobReviewData>(client: TestClient, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Structured<T>;

let fab: FakeFabForge;
beforeEach(() => {
  fab = fakeFabForge();
});
afterEach(() => fab.stop());

describe("FabForge MCP server", () => {
  it("declares tools with their views and visibility", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    const { tools } = await client.listTools();
    const meta = Object.fromEntries(tools.map((tool) => [tool.name, tool._meta?.ui]));
    expect(Object.keys(meta).sort()).toEqual(["fabforge_artifact_verify", "fabforge_job_approve", "fabforge_job_execute", "fabforge_job_review", "fabforge_workspace"]);
    expect(meta.fabforge_workspace).toMatchObject({ resourceUri: "ui://fabforge/workspace.html", visibility: ["model", "app"] });
    expect(meta.fabforge_job_review).toMatchObject({ resourceUri: "ui://fabforge/job-review.html", visibility: ["model", "app"] });
    expect(meta.fabforge_job_execute).toMatchObject({ resourceUri: "ui://fabforge/job-review.html", visibility: ["model", "app"] });
    expect(meta.fabforge_artifact_verify).toMatchObject({ resourceUri: "ui://fabforge/job-review.html", visibility: ["model", "app"] });
    expect(meta.fabforge_job_approve).toEqual({ visibility: ["app"] });
  });

  it("serves both views as self-contained MCP App resources", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    const { resources } = await client.listResources();
    expect(resources.map((resource) => [resource.uri, resource.mimeType]).sort()).toEqual([
      ["ui://fabforge/job-review.html", RESOURCE_MIME_TYPE],
      ["ui://fabforge/workspace.html", RESOURCE_MIME_TYPE],
    ]);
    for (const { uri } of resources) {
      const html = ((await client.readResource({ uri })).contents[0] as { text: string }).text;
      expect(html).toStartWith("<!doctype html>");
      expect(html).toContain("ui/initialize");
      expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
      expect(html.length).toBeLessThan(100_000);
    }
  });

  it("reads the workspace snapshot, scoped and authenticated, per section", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    const result = await call<WorkspaceData>(client, "fabforge_workspace", { section: "laser" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ workspaceId: "ws-1", section: "laser", pollSeconds: 60 });
    expect(result.structuredContent!.snapshot.jobs).toHaveLength(2);
    expect(result.content[0]!.text).toContain("FabForge Laser cutting for workspace ws-1");
    expect(result.content[0]!.text).toContain("- job-1 [ready] laser · machine laser-1");
    expect(result.content[0]!.text).not.toContain("job-2");
    expect(fab.requests.map((request) => request.url.pathname).sort()).toEqual(
      ["artifacts", "jobs", "kit-runs", "machines", "materials", "projects"].map((name) => `/api/fabrication/v0/${name}`),
    );
    expect(fab.requests.every((request) => request.url.searchParams.get("workspaceId") === "ws-1")).toBe(true);
    expect(fab.authorization.every((value) => value === "Bearer test-token")).toBe(true);
  });

  it("requires a human approval before executing, then executes and verifies", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    const review = await call(client, "fabforge_job_review", { jobId: "job-1" });
    expect(review.structuredContent).toMatchObject({ jobId: "job-1", workflow: { currentStage: "review", actions: [{ id: "approve" }] }, verification: { status: "running" } });
    expect(review.structuredContent!.machines?.map((machine) => machine.id)).toEqual(["laser-1"]);
    expect(review.content[0]!.text).toContain("a human approves in the job review view");

    const early = await call(client, "fabforge_job_execute", { jobId: "job-1" });
    expect(early).toMatchObject({ isError: true, content: [{ text: "Approve FabForge job job-1 in the job review before execution" }] });
    const earlyVerify = await call(client, "fabforge_artifact_verify", { jobId: "job-1", artifactPath: "out/panel.dxf" });
    expect(earlyVerify.content[0]!.text).toBe("Execute FabForge job job-1 before verifying its artifact");
    expect(fab.requests.some((request) => request.method === "POST")).toBe(false);

    const approved = await call(client, "fabforge_job_approve", { jobId: "job-1" });
    expect(approved.structuredContent).toMatchObject({ state: { approved: true }, workflow: { currentStage: "execute" } });

    const executed = await call(client, "fabforge_job_execute", { jobId: "job-1" });
    expect(executed.isError).toBeFalsy();
    expect(executed.structuredContent).toMatchObject({ execution: { status: "accepted", reference: "exec-42" }, workflow: { currentStage: "verify" } });
    expect(executed.content[0]!.text).toBe("FabForge job job-1 accepted on machine laser-1 (reference exec-42).");
    const execute = fab.requests.find((request) => request.method === "POST")!;
    expect(execute.url.pathname).toBe("/api/fabrication/v0/jobs/job-1/execute");
    expect(execute.body).toEqual({ process: "laser", machineId: "laser-1" });

    const verified = await call(client, "fabforge_artifact_verify", { jobId: "job-1", artifactPath: "out/panel.dxf" });
    expect(verified.structuredContent).toMatchObject({ verificationResult: { status: "passed", detail: "kerf within tolerance" }, state: { verificationStatus: "passed" } });
    expect(fab.requests.filter((request) => request.method === "POST")[1]!.body).toEqual({ artifactPath: "out/panel.dxf", expectedKinds: ["svg", "dxf"] });
  });

  it("refuses machines that cannot run the job", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    await call(client, "fabforge_job_approve", { jobId: "job-2" });
    const offline = await call(client, "fabforge_job_execute", { jobId: "job-2" });
    expect(offline.content[0]!.text).toBe("Machine printer-1 is offline");
    await call(client, "fabforge_job_approve", { jobId: "job-1" });
    const wrong = await call(client, "fabforge_job_execute", { jobId: "job-1", machineId: "printer-1" });
    expect(wrong.content[0]!.text).toBe("Machine printer-1 supports fdm, not laser");
    expect(fab.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("keeps a pending verification pending instead of claiming a pass", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    fab.respond((request, url) => (request.method === "POST" && url.pathname.endsWith("/verify") ? Response.json({ data: { status: "accepted" } }) : undefined));
    await call(client, "fabforge_job_approve", { jobId: "job-1" });
    await call(client, "fabforge_job_execute", { jobId: "job-1" });
    const result = await call(client, "fabforge_artifact_verify", { jobId: "job-1", artifactPath: "out/panel.dxf" });
    expect(result.structuredContent!.verificationResult).toEqual({ artifactPath: "out/panel.dxf", status: "pending" });
  });

  it("runs the local execute and verify commands when configured", async () => {
    const { client } = await connectedClient({ env: env(fab, { FABFORGE_EXECUTE_COMMAND: "echo submitted", FABFORGE_VERIFY_COMMAND: "false" }) });
    await call(client, "fabforge_job_approve", { jobId: "job-1" });
    const executed = await call(client, "fabforge_job_execute", { jobId: "job-1" });
    expect(executed.structuredContent!.execution).toEqual({ status: "accepted", reference: "submitted --job-id job-1 --process laser --machine-id laser-1" });
    const verified = await call(client, "fabforge_artifact_verify", { jobId: "job-1", artifactPath: "out/panel.dxf" });
    expect(verified.structuredContent!.verificationResult).toMatchObject({ status: "failed" });
    expect(fab.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("shares approval between plugin copies through the state file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fabforge-state-"));
    try {
      const path = join(dir, "state.sqlite");
      const panel = await connectedClient({ env: env(fab), store: sqliteWorkflowStore(path) });
      const agent = await connectedClient({ env: env(fab), store: sqliteWorkflowStore(path) });
      await call(panel.client, "fabforge_job_approve", { jobId: "job-1" });
      const executed = await call(agent.client, "fabforge_job_execute", { jobId: "job-1" });
      expect(executed.isError).toBeFalsy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("explains missing settings without calling FabForge", async () => {
    const { client } = await connectedClient({ env: { FABFORGE_URL: fab.url } });
    for (const name of ["fabforge_workspace", "fabforge_job_review"]) {
      const result = await call(client, name);
      expect(result).toMatchObject({ isError: true, content: [{ text: "FabForge is not configured: set FABFORGE_TOKEN and FABFORGE_WORKSPACE_ID in the FabForge plugin's settings (Settings → Tools → fabforge)." }] });
    }
    expect(fab.requests).toHaveLength(0);
  });

  it("reports an empty workspace honestly", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    fab.respond((request) => (request.method === "GET" ? Response.json({ data: [] }) : undefined));
    const result = await call(client, "fabforge_job_review");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent!.jobId).toBeUndefined();
    expect(result.content[0]!.text).toContain("No manufacturing jobs to review.");
    const missing = await call(client, "fabforge_job_review", { jobId: "nope" });
    expect(missing.content[0]!.text).toBe('FabForge job nope was not found in workspace "ws-1"');
  });

  it("keeps upstream failures short and free of URLs and bodies", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    fab.respond(() => new Response(`stack trace at ${fab.url}/internal`, { status: 502 }));
    const unavailable = await call(client, "fabforge_workspace");
    expect(unavailable).toMatchObject({ isError: true, content: [{ text: "FabForge is temporarily unavailable" }] });

    fab.respond(() => Response.json({ error: "bad token" }, { status: 401 }));
    const rejected = await call(client, "fabforge_workspace");
    expect(rejected.content[0]!.text).toBe('FabForge rejected the token (401); check FABFORGE_TOKEN has access to workspace "ws-1"');

    fab.respond(() => undefined);
    const wrong = await connectedClient({ env: env(fab, { FABFORGE_WORKSPACE_ID: "nope" }) });
    const missing = await call(wrong.client, "fabforge_workspace");
    expect(missing.content[0]!.text).toBe('FabForge could not find that resource in workspace "nope": workspace not found');
    for (const result of [unavailable, rejected, missing]) expect(result.content[0]!.text).not.toContain(fab.url);
  });

  it("bounds slow FabForge calls with a timeout", async () => {
    const { client } = await connectedClient({ env: env(fab), timeoutMs: 50 });
    fab.respond(async () => {
      await Bun.sleep(500);
      return Response.json({ data: [] });
    });
    const result = await call(client, "fabforge_workspace");
    expect(result).toMatchObject({ isError: true, content: [{ text: "FabForge did not respond within 1s" }] });
  });

  it("reports an unreachable FabForge without the URL", async () => {
    const { client } = await connectedClient({ env: { ...env(fab), FABFORGE_URL: "http://127.0.0.1:1" } });
    const result = await call(client, "fabforge_workspace");
    expect(result).toMatchObject({ isError: true, content: [{ text: "Could not reach FabForge; check FABFORGE_URL and the network" }] });
  });
});
