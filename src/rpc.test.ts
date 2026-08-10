import { describe, expect, test } from "bun:test";
import { createRpcHandler } from "./rpc.ts";

describe("FabForge RPC", () => {
  test("serves fabrication cards from the cached workspace snapshot", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [] }, refresh: async () => ({ projects: [], kitRuns: [] }) });
    await expect(handler("surface.get", { navigationId: "fabforge.kit-runs" })).resolves.toMatchObject({ ok: true, result: { pluginId: "com.t3code.fabforge", navigationId: "fabforge.kit-runs" } });
  });

  test("serves the station serial-console panel and action", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [{ id: "run-1", status: "running" }] }, refresh: async () => ({ projects: [], kitRuns: [] }) });
    await expect(handler("panel.get", { panelId: "fabforge.kit-runs" })).resolves.toMatchObject({ ok: true, result: { content: { kind: "serial-console", connection: "connected" } } });
    await expect(handler("action.execute", { actionId: "fabforge.open-console" })).resolves.toMatchObject({ ok: true, result: { status: "completed" } });
  });

  test("serves the manufacturing job review workflow", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [], jobs: [], machines: [], materials: [] }, refresh: async () => ({ projects: [], kitRuns: [], jobs: [], machines: [], materials: [] }) });
    await expect(handler("workflow.get", { workflowId: "fabforge.job-review" })).resolves.toMatchObject({ ok: true, result: { workflowId: "fabforge.job-review" } });
  });

  test("serves job verification as a native T3 panel", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [], jobs: [{ id: "job-1", process: "fdm", status: "ready" }], machines: [], materials: [] }, refresh: async () => ({ projects: [], kitRuns: [], jobs: [], machines: [], materials: [] }) });
    await expect(handler("panel.get", { panelId: "fabforge.job-verification" })).resolves.toMatchObject({ ok: true, result: { content: { kind: "verification", status: "running" } } });
  });
});
