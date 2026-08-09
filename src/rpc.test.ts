import { describe, expect, test } from "bun:test";
import { createRpcHandler } from "./rpc.ts";

describe("FabForge RPC", () => {
  test("serves fabrication cards from the cached workspace snapshot", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], kitRuns: [] }, refresh: async () => ({ projects: [], kitRuns: [] }) });
    await expect(handler("surface.get", { navigationId: "fabforge.kit-runs" })).resolves.toMatchObject({ ok: true, result: { pluginId: "com.t3code.fabforge", navigationId: "fabforge.kit-runs" } });
  });
});
