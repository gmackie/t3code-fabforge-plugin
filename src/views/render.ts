// Pure HTML renderers shared by the ui:// views (bundled into the browser) and
// the tests. All dynamic text goes through esc().
import type { FabForgeArtifact, FabForgeJob, FabForgeMachine, FabForgeProcessControl, FabForgeSnapshot, FabForgeWorkflowState, JobVerificationSummary, ManufacturingWorkflowModel } from "../fabforge.ts";
import { SECTIONS, SECTION_TITLES, sectionGroups, sectionMetrics, type Section, type Tone } from "../sections.ts";

export type WorkspaceData = {
  workspaceId: string;
  section: Section;
  snapshot: FabForgeSnapshot;
  pollSeconds: number;
  refreshedAt: string;
};

export type JobReviewData = {
  workspaceId: string;
  verification: JobVerificationSummary;
  jobs: readonly (FabForgeJob & { control: FabForgeProcessControl })[];
  artifacts: readonly FabForgeArtifact[];
  pollSeconds: number;
  refreshedAt: string;
  /** Present when the workspace has a job to review. */
  jobId?: string;
  state?: FabForgeWorkflowState;
  machines?: readonly FabForgeMachine[];
  workflow?: ManufacturingWorkflowModel;
  execution?: { status: string; reference?: string };
  verificationResult?: { artifactPath: string; status: "passed" | "failed" | "pending"; detail?: string };
};

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

function pill(label: string, tone: Tone | string = "neutral"): string {
  return `<span class="pill pill-${esc(tone)}">${esc(label)}</span>`;
}

const STATE_TONE: Record<string, Tone> = { completed: "positive", active: "warning", pending: "neutral", blocked: "negative", failed: "negative", passed: "positive", idle: "neutral", running: "warning" };

function header(title: string, refreshedAt: string): string {
  return `<header>
  <h1>${esc(title)}</h1>
  <div class="header-meta"><span>Refreshed ${esc(time(refreshedAt))}</span><button type="button" data-action="refresh">Refresh</button></div>
</header>`;
}

const alert = (error?: string) => (error ? `<p class="error" role="alert">${esc(error)}</p>` : "");

export function renderWorkspace(data: WorkspaceData, options: { error?: string } = {}): string {
  const tabs = SECTIONS.map((section) => `<button type="button" class="tab" data-action="section" data-section="${esc(section)}"${section === data.section ? ' aria-current="page"' : ""}>${esc(SECTION_TITLES[section])}</button>`).join("");
  const metrics =
    data.section === "overview"
      ? `<div class="metrics">${sectionMetrics(data.snapshot)
          .map((metric) => `<div class="metric"><div class="metric-value pill-${esc(metric.tone)}">${esc(metric.value)}</div><div class="metric-title">${esc(metric.title)}</div></div>`)
          .join("")}</div>`
      : "";
  const groups = sectionGroups(data.snapshot, data.section)
    .map((group) => {
      const rows = group.items.length
        ? group.items
            .map(
              (item) => `<li class="row">
  <div class="row-main">
    <div class="row-title">${esc(item.title)}</div>
    <div class="row-meta">${item.status ? pill(item.status, item.tone) : ""}${item.detail ? `<span>${esc(item.detail)}</span>` : ""}</div>
  </div>
</li>`,
            )
            .join("\n")
        : `<li class="empty">No ${esc(group.title.toLowerCase())} in this workspace.</li>`;
      return `<section aria-label="${esc(group.title)}"><h2>${esc(group.title)} <span class="count">${group.items.length}</span></h2><ul>${rows}</ul></section>`;
    })
    .join("\n");
  return `${header(`FabForge · ${SECTION_TITLES[data.section]}`, data.refreshedAt)}
<p class="subject">Workspace <span class="mono">${esc(data.workspaceId)}</span></p>
<nav class="tabs" aria-label="FabForge sections">${tabs}</nav>
${alert(options.error)}
${metrics}
${groups}`;
}

export function renderJobReview(data: JobReviewData, options: { error?: string; busy?: boolean } = {}): string {
  const disabled = options.busy ? " disabled" : "";
  const jobOptions = data.jobs.map((job) => `<option value="${esc(job.id)}"${job.id === data.jobId ? " selected" : ""}>${esc(job.id)} · ${esc(job.process)} · ${esc(job.status)}</option>`).join("");
  const summary = `<p class="subject">${pill(data.verification.status, STATE_TONE[data.verification.status])}<span>${esc(data.verification.summary)}</span></p>`;
  const top = `${header("FabForge job review", data.refreshedAt)}
<p class="subject">Workspace <span class="mono">${esc(data.workspaceId)}</span></p>
${summary}
${alert(options.error)}`;
  if (!data.jobId || !data.workflow) return `${top}<p class="empty">FabForge has no manufacturing jobs to review in this workspace.</p>`;
  const job = data.jobs.find((candidate) => candidate.id === data.jobId)!;
  const workflow = data.workflow;
  const steps = workflow.steps
    .map((step) => `<li class="row"><div class="row-main"><div class="row-title">${esc(step.title)}</div>${step.detail ? `<div class="row-meta"><span>${esc(step.detail)}</span></div>` : ""}</div>${pill(step.state, STATE_TONE[step.state])}</li>`)
    .join("\n");
  const evidence = (workflow.evidence ?? []).map((item) => `<li class="row"><div class="row-main"><div class="row-title">${esc(item.title)}</div>${item.detail ? `<div class="row-meta"><span>${esc(item.detail)}</span></div>` : ""}</div>${pill(item.kind, item.status)}</li>`).join("\n");
  const artifacts = data.artifacts.filter((artifact) => artifact.jobId === job.id);
  const artifactRows = artifacts.length
    ? artifacts.map((artifact) => `<li class="row"><div class="row-main"><div class="row-title mono">${esc(artifact.path)}</div><div class="row-meta"><span>${esc(artifact.kind)}</span>${artifact.detail ? `<span>${esc(artifact.detail)}</span>` : ""}</div></div>${pill(artifact.status, STATE_TONE[artifact.status])}</li>`).join("\n")
    : `<li class="empty">No artifacts recorded for this job yet.</li>`;
  const machineOptions = (data.machines ?? []).map((machine) => `<option value="${esc(machine.id)}"${machine.id === job.machineId ? " selected" : ""}>${esc(machine.name)} · ${esc(machine.status)}</option>`).join("");
  const action = workflow.actions?.[0];
  const firstArtifact = artifacts[0]?.path ?? "";
  let controls = "";
  if (action?.id === "approve") {
    controls = `<p class="hint">Approving lets an agent or this view send job ${esc(job.id)} to a ${esc(job.process)} machine.</p><button type="button" class="primary" data-action="approve"${disabled}>${esc(action.title)}</button>`;
  } else if (action?.id === "execute") {
    controls = machineOptions
      ? `<label>Machine <select name="machineId">${machineOptions}</select></label><button type="button" class="primary" data-action="execute"${disabled}>${esc(action.title)}</button>`
      : `<p class="error">No ${esc(job.process)} machine in this workspace can run this job.</p>`;
  } else if (action?.id === "verify") {
    controls = `<label>Artifact <input name="artifactPath" value="${esc(firstArtifact)}" placeholder="out/part.${esc(job.control.artifactKinds[0] ?? "gcode")}"></label><button type="button" class="primary" data-action="verify"${disabled}>${esc(action.title)}</button>`;
  } else {
    controls = `<button type="button" data-action="reapprove"${disabled}>Approve again to rerun</button>`;
  }
  const outcome = data.verificationResult
    ? `<p class="subject">${pill(data.verificationResult.status, STATE_TONE[data.verificationResult.status])}<span class="mono">${esc(data.verificationResult.artifactPath)}</span>${data.verificationResult.detail ? `<span>${esc(data.verificationResult.detail)}</span>` : ""}</p>`
    : data.execution
      ? `<p class="subject">${pill(data.execution.status, "positive")}<span>Sent to the machine${data.execution.reference ? ` · reference <span class="mono">${esc(data.execution.reference)}</span>` : ""}</span></p>`
      : "";
  return `${top}
<label class="job-picker">Job <select name="jobId">${jobOptions}</select></label>
<p class="subject">${pill(job.status, STATE_TONE[job.status] ?? "warning")}<span>${esc(job.process)} · ${esc(job.control.action)}</span>${job.machineId ? `<span>machine ${esc(job.machineId)}</span>` : ""}${job.material ? `<span>material ${esc(job.material)}</span>` : ""}<span>expects ${esc(job.control.artifactKinds.join("/") || "operator evidence")}</span></p>
${outcome}
<section aria-label="Next action" class="controls"><h2>Next action</h2>${controls}</section>
<section aria-label="Stages"><h2>Stages <span class="count">${esc(workflow.currentStage)}</span></h2><ul>${steps}</ul></section>
<section aria-label="Evidence"><h2>Evidence</h2><ul>${evidence}</ul></section>
<section aria-label="Artifacts"><h2>Artifacts <span class="count">${artifacts.length}</span></h2><ul>${artifactRows}</ul></section>`;
}

export const STYLES = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: transparent; --line: #d0d7de; --accent: #0969da; --pos: #1a7f37; --neg: #cf222e; --warn: #9a6700; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:root[data-theme="dark"] { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--fg); background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.header-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); }
ul { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; } .row-title { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 12px; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow-wrap: anywhere; }
.count { font-weight: 400; } .empty { color: var(--muted); padding: 8px 0; border-top: 1px solid var(--line); }
.pill { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 17px; white-space: nowrap; }
.pill-positive { color: var(--pos); } .pill-negative { color: var(--neg); } .pill-warning { color: var(--warn); } .pill-neutral { color: var(--muted); }
button, select, input { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; }
button { cursor: pointer; } button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
button.primary { border-color: var(--accent); color: var(--accent); }
.subject { margin: 6px 0 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: var(--muted); }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px; }
.tab[aria-current="page"] { border-color: var(--accent); color: var(--accent); }
.metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-top: 12px; }
.metric { border: 1px solid var(--line); border-radius: 8px; padding: 8px; } .metric-value { font-size: 18px; font-weight: 600; } .metric-title { color: var(--muted); font-size: 12px; }
.metric-value.pill-neutral { color: var(--fg); }
.controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; } .controls h2 { width: 100%; }
label { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); } .job-picker { margin-top: 10px; }
input { min-width: 14em; } .hint { margin: 0; color: var(--muted); width: 100%; }
.error { color: var(--neg); }
`;
