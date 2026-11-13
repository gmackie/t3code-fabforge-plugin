import { createViewBridge, toolData, type HostContext } from "./bridge.ts";
import { esc, renderWorkspace, type WorkspaceData } from "./render.ts";

// The FabForge workspace view: inline after fabforge_workspace, and as the
// project panel (projects) and thread panel (kit runs), which T3 opens by
// running fabforge_workspace with the panel's section.
const root = document.getElementById("app")!;
const bridge = createViewBridge(window as never, { name: "fabforge-workspace", version: "0.4.0" });

let data: WorkspaceData | undefined;
let error: string | undefined;
let busy = false;
let timer: ReturnType<typeof setInterval> | undefined;

function draw() {
  if (data) root.innerHTML = renderWorkspace(data, error ? { error } : {});
  else if (error) root.innerHTML = `<p class="error" role="alert">${esc(error)}</p>`;
  else root.innerHTML = `<p class="empty">Loading FabForge…</p>`;
}

function show(next: WorkspaceData) {
  data = next;
  error = undefined;
  draw();
  // Follow the configured refresh interval while the view is open.
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === "visible") void load(data?.section);
  }, Math.max(15, next.pollSeconds) * 1000);
}

async function load(section?: string) {
  if (busy) return;
  busy = true;
  try {
    show(toolData<WorkspaceData>(await bridge.callTool("fabforge_workspace", section ? { section } : {})));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    draw();
  }
  busy = false;
}

bridge.onHostContext = (context: HostContext) => {
  if (context.theme) document.documentElement.dataset.theme = context.theme;
};

bridge.onToolResult = (result) => {
  if (result.isError) {
    error = result.content?.find((part) => part.type === "text")?.text ?? "FabForge failed to load.";
    draw();
    return;
  }
  show(toolData<WorkspaceData>(result));
};

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  if (target.dataset.action === "section" && target.dataset.section) void load(target.dataset.section);
  if (target.dataset.action === "refresh") void load(data?.section);
});

new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);

draw();
// The host delivers the tool result; if nothing arrives, load the overview.
void bridge.connect().then(() => setTimeout(() => void (data || error ? undefined : load()), 250));
