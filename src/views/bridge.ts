// Minimal MCP Apps (SEP-1865) view-side client: JSON-RPC 2.0 over postMessage
// to the host frame. The official App class from @modelcontextprotocol/ext-apps
// bundles to ~600KB (zod + SDK); this covers what the FabForge views use and is
// tested against ext-apps' own host-side AppBridge in bridge.test.ts.

export const PROTOCOL_VERSION = "2026-01-26";

export type CallToolResult = {
  content?: readonly { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

// T3 thread panels also get threadId, projectId and cwd (T3CODE-74).
export type HostContext = {
  theme?: "light" | "dark";
  t3?: { threadId?: string; projectId?: string; cwd?: string };
  [key: string]: unknown;
};

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

export type BridgeWindow = {
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: "message", listener: (event: { data: unknown; source?: unknown }) => void): void;
};

export type ViewBridge = {
  connect(): Promise<{ hostContext?: HostContext }>;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  sendMessage(text: string): Promise<void>;
  sendSize(width: number, height: number): void;
  onToolInput?: (args: Record<string, unknown>) => void;
  onToolResult?: (result: CallToolResult) => void;
  onHostContext?: (context: HostContext) => void;
};

export function createViewBridge(win: BridgeWindow, appInfo: { name: string; version: string }): ViewBridge {
  let nextId = 1;
  const pending = new Map<number | string, { resolve(value: unknown): void; reject(error: Error): void }>();
  const post = (message: Omit<JsonRpcMessage, "jsonrpc">) => win.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");

  function request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      post({ id, method, params });
    });
  }

  const bridge: ViewBridge = {
    async connect() {
      const result = await request<{ hostContext?: HostContext }>("ui/initialize", {
        protocolVersion: PROTOCOL_VERSION,
        appInfo,
        appCapabilities: {},
      });
      post({ method: "ui/notifications/initialized", params: {} });
      if (result.hostContext) bridge.onHostContext?.(result.hostContext);
      return result;
    },
    callTool: (name, args = {}) => request<CallToolResult>("tools/call", { name, arguments: args }),
    async sendMessage(text) {
      await request("ui/message", { role: "user", content: [{ type: "text", text }] });
    },
    sendSize(width, height) {
      post({ method: "ui/notifications/size-changed", params: { width, height } });
    },
  };

  win.addEventListener("message", (event) => {
    // Only the embedding host may talk to the view.
    if (event.source !== undefined && event.source !== win.parent) return;
    const message = event.data as JsonRpcMessage | null;
    if (!message || message.jsonrpc !== "2.0") return;

    if (message.id !== undefined && !message.method) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }

    const params = message.params ?? {};
    switch (message.method) {
      case "ui/notifications/tool-input":
        bridge.onToolInput?.((params.arguments as Record<string, unknown>) ?? {});
        break;
      case "ui/notifications/tool-result":
        bridge.onToolResult?.(params as CallToolResult);
        break;
      case "ui/notifications/host-context-changed":
        bridge.onHostContext?.(params as HostContext);
        break;
      case "ui/resource-teardown":
      case "ping":
        if (message.id !== undefined) post({ id: message.id, result: {} });
        break;
      default:
        if (message.id !== undefined) post({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
    }
  });

  return bridge;
}

export function toolData<T>(result: CallToolResult): T {
  if (result.isError) {
    const text = result.content?.find((part) => part.type === "text")?.text;
    throw new Error(text ?? "FabForge tool call failed");
  }
  return result.structuredContent as T;
}
