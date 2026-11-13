// Test fixtures: a fake FabForge fabrication API on a local Bun.serve port, and
// an MCP client connected in memory to the plugin server.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createFabForgeMcpServer, type FabForgeServerOptions } from "./server.ts";
import { memoryWorkflowStore } from "./state.ts";

export const WORKSPACE = "ws-1";

export const FIXTURE = {
  projects: [{ id: "p1", name: "Rover chassis" }],
  "kit-runs": [{ id: "k1", status: "running" }, { id: "k2", status: "blocked" }],
  jobs: [
    { id: "job-1", process: "laser", status: "ready", machineId: "laser-1", material: "acrylic" },
    { id: "job-2", process: "fdm", status: "queued", machineId: "printer-1" },
  ],
  machines: [
    { id: "laser-1", name: "Laser <1>", process: "laser", status: "online" },
    { id: "printer-1", name: "Printer 1", process: "fdm", status: "offline" },
  ],
  materials: [{ id: "m1", name: "Acrylic 3mm", process: "laser", stock: "available" }],
  artifacts: [{ id: "a1", jobId: "job-1", path: "out/panel.dxf", kind: "dxf", status: "pending" }],
} as const;

export type FakeFabForge = {
  url: string;
  requests: { method: string; url: URL; body?: unknown }[];
  authorization: (string | null)[];
  respond: (handler: (request: Request, url: URL) => Response | Promise<Response> | undefined) => void;
  stop: () => void;
};

export function fakeFabForge(): FakeFabForge {
  const requests: FakeFabForge["requests"] = [];
  const authorization: (string | null)[] = [];
  let override: ((request: Request, url: URL) => Response | Promise<Response> | undefined) | undefined;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ method: request.method, url, ...(body === undefined ? {} : { body }) });
      authorization.push(request.headers.get("authorization"));
      const custom = await override?.(request, url);
      if (custom) return custom;
      if (url.searchParams.get("workspaceId") !== WORKSPACE) return Response.json({ error: "workspace not found" }, { status: 404 });
      const list = url.pathname.match(/^\/api\/fabrication\/v0\/([a-z-]+)$/)?.[1];
      if (request.method === "GET" && list && list in FIXTURE) return Response.json({ data: FIXTURE[list as keyof typeof FIXTURE] });
      if (request.method === "POST" && /\/jobs\/[^/]+\/execute$/.test(url.pathname)) return Response.json({ data: { status: "accepted", id: "exec-42" } });
      if (request.method === "POST" && /\/jobs\/[^/]+\/verify$/.test(url.pathname)) return Response.json({ data: { status: "accepted", verification: "passed", detail: "kerf within tolerance" } });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    authorization,
    respond: (next) => void (override = next),
    stop: () => void server.stop(true),
  };
}

export const env = (fake: FakeFabForge, extra: Record<string, string> = {}) => ({ FABFORGE_URL: `${fake.url}/`, FABFORGE_TOKEN: "test-token", FABFORGE_WORKSPACE_ID: WORKSPACE, ...extra });

export async function connectedClient(options: FabForgeServerOptions = {}) {
  const store = options.store ?? memoryWorkflowStore();
  const server = createFabForgeMcpServer({ ...options, store });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server, store };
}
