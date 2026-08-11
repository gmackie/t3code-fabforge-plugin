import { describe, expect, test } from "bun:test";
import { buildCockpitViewModel, buildManufacturingWorkflow, buildProcessControl, buildSurfaceModel, createFabForgeClient, createPollingCoordinator, normalizeFabForgeSnapshot } from "./fabforge.ts";

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
      "https://fabforge.example/api/fabrication/v0/jobs?workspaceId=w1",
      "https://fabforge.example/api/fabrication/v0/machines?workspaceId=w1",
      "https://fabforge.example/api/fabrication/v0/materials?workspaceId=w1",
      "https://fabforge.example/api/fabrication/v0/artifacts?workspaceId=w1",
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

  test("normalizes manufacturing processes, machines, and materials", () => {
    const snapshot = normalizeFabForgeSnapshot({
      projects: [{ id: "p1", name: "Fixture" }],
      runs: [{ id: "k1", status: "queued" }],
      jobs: [{ id: "job-1", process: "laser", status: "ready", machineId: "laser-1", material: "acrylic" }],
      machines: [{ id: "laser-1", name: "Laser 1", process: "laser", status: "online" }],
      materials: [{ id: "mat-1", name: "Acrylic", process: "laser", stock: "available" }],
    });
    expect(snapshot.jobs).toEqual([{ id: "job-1", process: "laser", status: "ready", machineId: "laser-1", material: "acrylic" }]);
    expect(snapshot.machines).toEqual([{ id: "laser-1", name: "Laser 1", process: "laser", status: "online" }]);
    expect(snapshot.materials).toEqual([{ id: "mat-1", name: "Acrylic", process: "laser", stock: "available" }]);
  });

  test("normalizes fabrication artifacts with stable kinds and verification state", () => {
    const snapshot = normalizeFabForgeSnapshot({
      projects: [], runs: [],
      artifacts: [
        { id: "artifact-1", jobId: "job-1", path: "out/part.gcode", status: "passed" },
        { id: "artifact-2", jobId: "job-2", path: "out/panel.dxf", kind: "dxf", status: "pending", detail: "Awaiting cut inspection" },
      ],
    });
    expect(snapshot.artifacts).toEqual([
      { id: "artifact-1", jobId: "job-1", path: "out/part.gcode", kind: "gcode", status: "passed" },
      { id: "artifact-2", jobId: "job-2", path: "out/panel.dxf", kind: "dxf", status: "pending", detail: "Awaiting cut inspection" },
    ]);
  });

  test("builds a manufacturing job review workflow", () => {
    const workflow = buildManufacturingWorkflow({ projects: [], kitRuns: [], jobs: [{ id: "job-1", process: "fdm", status: "ready" }], machines: [], materials: [] });
    expect(workflow.currentStage).toBe("review");
    expect(workflow.evidence?.[0]?.kind).toBe("check");
    expect(workflow.actions?.[0]?.id).toBe("approve");
  });

  test("derives safe controls and artifact expectations per process", () => {
    expect(buildProcessControl({ id: "job-1", process: "fdm", status: "ready" })).toEqual({ action: "print", artifactKinds: ["gcode", "nc"] });
    expect(buildProcessControl({ id: "job-2", process: "laser", status: "ready" })).toEqual({ action: "cut", artifactKinds: ["svg", "dxf"] });
    expect(buildProcessControl({ id: "job-3", process: "plasma", status: "ready" })).toEqual({ action: "cut", artifactKinds: ["dxf"] });
  });

  test("executes and verifies a job through scoped adapter callbacks", async () => {
    const requests: { path: string; body: unknown }[] = [];
    const client = createFabForgeClient({ endpoint: "https://fabforge.example", token: "secret", workspaceId: "w1", fetchImpl: async (input, init) => {
      requests.push({ path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ data: { status: "accepted", verification: "passed" } }), { status: 200 });
    } });
    await expect(client.executeJob({ jobId: "job-2", process: "laser", machineId: "laser-1" })).resolves.toEqual({ status: "accepted", verification: "passed" });
    await expect(client.verifyArtifact({ jobId: "job-2", artifactPath: "out/job-2.dxf", expectedKinds: ["dxf"] })).resolves.toEqual({ status: "accepted", verification: "passed" });
    expect(requests).toEqual([
      { path: "/api/fabrication/v0/jobs/job-2/execute", body: { process: "laser", machineId: "laser-1" } },
      { path: "/api/fabrication/v0/jobs/job-2/verify", body: { artifactPath: "out/job-2.dxf", expectedKinds: ["dxf"] } },
    ]);
  });
});
