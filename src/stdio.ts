import { createFabForgeClient, type FabForgeSnapshot } from "./fabforge.ts";
import { createRpcHandler } from "./rpc.ts";

let snapshot = JSON.parse(process.env.T3_PLUGIN_SNAPSHOT ?? '{"projects":[],"kitRuns":[]}') as FabForgeSnapshot;
const client = process.env.T3_PLUGIN_ENDPOINT && process.env.T3_PLUGIN_TOKEN && process.env.T3_PLUGIN_WORKSPACE
  ? createFabForgeClient({ endpoint: process.env.T3_PLUGIN_ENDPOINT, token: process.env.T3_PLUGIN_TOKEN, workspaceId: process.env.T3_PLUGIN_WORKSPACE })
  : null;
const refresh = async () => { if (client) snapshot = await client.snapshot(); return snapshot; };
const handler = createRpcHandler({ get snapshot() { return snapshot; }, refresh });
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
