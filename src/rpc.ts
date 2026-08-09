import { buildSurfaceModel, type FabForgeSnapshot } from "./fabforge.ts";

export function createRpcHandler(coordinator: {
  snapshot: FabForgeSnapshot | null;
  refresh(): Promise<FabForgeSnapshot>;
}) {
  return async (method: string, payload?: { navigationId?: string }) => {
    if (method !== "surface.get") return { ok: false as const, error: `unsupported FabForge RPC method: ${method}` };
    const snapshot = coordinator.snapshot ?? (await coordinator.refresh());
    return { ok: true as const, result: buildSurfaceModel(snapshot, payload?.navigationId) };
  };
}
