import { describe, expect, test } from "bun:test";
import { buildCockpitViewModel, buildSurfaceModel, createFabForgeClient, createPollingCoordinator, normalizeFabForgeSnapshot } from "./fabforge.ts";

describe("FabForge adapter", () => {
  test("normalizes projects and kit runs", () => {
    expect(normalizeFabForgeSnapshot({ projects: [{ id: "p1", name: "Fixture" }], runs: [{ id: "k1", status: "queued" }] })).toEqual({
      projects: [{ id: "p1", name: "Fixture" }],
      kitRuns: [{ id: "k1", status: "queued" }],
    });
  });

  test("keeps workspace scoping on every read", async () => {
    const urls: string[] = [];
    const client = createFabForgeClient({ endpoint: "https://fabforge.example", token: "secret", workspaceId: "w1", fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    } });
    await client.snapshot();
    expect(urls).toEqual([
      "https://fabforge.example/api/fabrication/v0/projects?workspaceId=w1",
      "https://fabforge.example/api/fabrication/v0/kit-runs?workspaceId=w1",
    ]);
  });

  test("caches the latest fabrication refresh", async () => {
    const coordinator = createPollingCoordinator({ refresh: async () => ({ projects: [], kitRuns: [] }) });
    await coordinator.refresh();
    expect(coordinator.snapshot).toEqual({ projects: [], kitRuns: [] });
  });

  test("builds fabrication cockpit navigation and blockers metric", () => {
    expect(buildCockpitViewModel({ projects: [{ id: "p1", name: "Fixture" }], kitRuns: [{ id: "k1", status: "blocked" }, { id: "k2", status: "complete" }] })).toEqual({
      navigation: ["projects", "components", "work-orders", "kit-runs", "evidence"],
      metrics: { projects: 1, activeKitRuns: 1, blockedKitRuns: 1 },
    });
  });

  test("builds native T3 fabrication cards from normalized runs", () => {
    const surface = buildSurfaceModel({ projects: [{ id: "p1", name: "Fixture" }], kitRuns: [{ id: "k1", status: "blocked" }] });
    expect(surface.pluginId).toBe("com.t3code.fabforge");
    expect(surface.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "blocked-kit-runs", value: "1" }),
      expect.objectContaining({ id: "kit-runs" }),
    ]));
  });
});
