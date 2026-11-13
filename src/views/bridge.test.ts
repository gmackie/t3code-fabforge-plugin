import { afterAll, describe, expect, it } from "bun:test";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";

import { connectedClient, env, fakeFabForge } from "../testing.ts";
import { createViewBridge, toolData, type BridgeWindow, type CallToolResult } from "./bridge.ts";
import type { JobReviewData, WorkspaceData } from "./render.ts";

// Wires the view bridge to ext-apps' reference host (AppBridge) the way an
// iframe is wired to its parent: the host sends with postMessage into the view
// window, the view posts to window.parent.
function frame() {
  const listeners: ((event: { data: unknown; source?: unknown }) => void)[] = [];
  const parent = {
    postMessage(message: unknown) {
      queueMicrotask(() => hostTransport.onmessage?.(structuredClone(message) as never));
    },
  };
  const win: BridgeWindow = { parent, addEventListener: (_type, listener) => void listeners.push(listener) };
  const hostTransport = {
    onmessage: undefined as ((message: never) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
    async start() {},
    async close() {
      hostTransport.onclose?.();
    },
    async send(message: unknown) {
      queueMicrotask(() => listeners.forEach((listener) => listener({ data: structuredClone(message), source: parent })));
    },
  };
  return { win, hostTransport, inject: (data: unknown, source: unknown) => listeners.forEach((listener) => listener({ data, source })) };
}

const fab = fakeFabForge();
afterAll(() => fab.stop());

describe("view bridge against the ext-apps reference host", () => {
  it("initializes, receives the tool result and calls server tools, including the app-only approval", async () => {
    const { client } = await connectedClient({ env: env(fab) });
    const host = new AppBridge(client as never, { name: "reference-host", version: "1.0.0" }, { serverTools: {} }, { hostContext: { t3: { threadId: "thread-1" } } as never });
    const { win, hostTransport } = frame();
    const initialized = new Promise<void>((resolve) => {
      host.oninitialized = () => resolve();
    });
    await host.connect(hostTransport as never);

    const view = createViewBridge(win, { name: "fabforge-job-review", version: "0.4.0" });
    const received: CallToolResult[] = [];
    view.onToolResult = (result) => received.push(result);
    const { hostContext } = await view.connect();
    await initialized;
    expect(hostContext?.t3?.threadId).toBe("thread-1");

    await host.sendToolResult((await client.callTool({ name: "fabforge_workspace", arguments: { section: "kit-runs" } })) as never);
    await Bun.sleep(0);
    expect(toolData<WorkspaceData>(received[0]!).section).toBe("kit-runs");

    // View -> host -> MCP server round trip, as the Approve button does.
    const approved = toolData<JobReviewData>(await view.callTool("fabforge_job_approve", { jobId: "job-1" }));
    expect(approved.state?.approved).toBe(true);
  });

  it("ignores messages that do not come from the host frame", () => {
    const { win, inject } = frame();
    const view = createViewBridge(win, { name: "fabforge", version: "0" });
    let called = false;
    view.onToolResult = () => {
      called = true;
    };
    inject({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: {} }, { evil: true });
    expect(called).toBe(false);
  });

  it("surfaces tool errors from structured results", () => {
    expect(() => toolData({ isError: true, content: [{ type: "text", text: "FabForge is temporarily unavailable" }] })).toThrow("FabForge is temporarily unavailable");
  });
});
