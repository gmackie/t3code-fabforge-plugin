import { createViewBridge, toolData, type HostContext } from "./bridge.ts";
import { esc, renderJobReview, type JobReviewData } from "./render.ts";

// The FabForge job review: inline after fabforge_job_review, execute or
// verify, and as the job verification thread panel. Approval only happens
// here, through the app-only fabforge_job_approve tool.
const root = document.getElementById("app")!;
const bridge = createViewBridge(window as never, { name: "fabforge-job-review", version: "0.4.0" });

let data: JobReviewData | undefined;
let error: string | undefined;
let busy = false;
let timer: ReturnType<typeof setInterval> | undefined;

function draw() {
  if (data) root.innerHTML = renderJobReview(data, { busy, ...(error ? { error } : {}) });
  else if (error) root.innerHTML = `<p class="error" role="alert">${esc(error)}</p>`;
  else root.innerHTML = `<p class="empty">Loading FabForge job review…</p>`;
}

function show(next: JobReviewData) {
  data = next;
  error = undefined;
  draw();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === "visible" && !busy) void call("fabforge_job_review", data?.jobId ? { jobId: data.jobId } : {});
  }, Math.max(15, next.pollSeconds) * 1000);
}

async function call(name: string, args: Record<string, unknown>) {
  if (busy) return;
  busy = true;
  draw();
  try {
    show(toolData<JobReviewData>(await bridge.callTool(name, args)));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  busy = false;
  draw();
}

const field = (name: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)?.value.trim() ?? "";

bridge.onHostContext = (context: HostContext) => {
  if (context.theme) document.documentElement.dataset.theme = context.theme;
};

bridge.onToolResult = (result) => {
  if (result.isError) {
    error = result.content?.find((part) => part.type === "text")?.text ?? "FabForge job review failed to load.";
    draw();
    return;
  }
  show(toolData<JobReviewData>(result));
};

root.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.name === "jobId" && target.value) void call("fabforge_job_review", { jobId: target.value });
});

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target || busy) return;
  const jobId = data?.jobId;
  switch (target.dataset.action) {
    case "refresh":
      void call("fabforge_job_review", jobId ? { jobId } : {});
      break;
    case "approve":
    case "reapprove":
      if (jobId) void call("fabforge_job_approve", { jobId });
      break;
    case "execute":
      if (jobId) void call("fabforge_job_execute", { jobId, ...(field("machineId") ? { machineId: field("machineId") } : {}) });
      break;
    case "verify":
      if (!jobId) break;
      if (!field("artifactPath")) {
        error = "Enter the artifact path to verify.";
        draw();
        break;
      }
      void call("fabforge_artifact_verify", { jobId, artifactPath: field("artifactPath") });
      break;
  }
});

new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);

draw();
void bridge.connect().then(() => setTimeout(() => void (data || error ? undefined : call("fabforge_job_review", {})), 250));
