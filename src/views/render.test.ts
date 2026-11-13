import { describe, expect, it } from "bun:test";

import { buildJobVerification, buildManufacturingWorkflow, buildProcessControl, normalizeFabForgeSnapshot } from "../fabforge.ts";
import { FIXTURE } from "../testing.ts";
import { renderJobReview, renderWorkspace, type JobReviewData } from "./render.ts";

const snapshot = normalizeFabForgeSnapshot({ ...FIXTURE, runs: FIXTURE["kit-runs"] });

function review(state: JobReviewData["state"] = {}): JobReviewData {
  const job = snapshot.jobs![0]!;
  return {
    workspaceId: "ws-1",
    verification: buildJobVerification(snapshot),
    jobs: snapshot.jobs!.map((candidate) => ({ ...candidate, control: buildProcessControl(candidate) })),
    artifacts: snapshot.artifacts!,
    pollSeconds: 60,
    refreshedAt: "2026-11-13T00:00:00Z",
    jobId: job.id,
    state,
    machines: snapshot.machines!.filter((machine) => machine.process === job.process),
    workflow: buildManufacturingWorkflow({ ...snapshot, jobs: [job] }, { ...state, jobId: job.id }),
  };
}

describe("workspace view renderer", () => {
  it("renders section tabs, metrics and lists, escaping FabForge content", () => {
    const html = renderWorkspace({ workspaceId: "ws-1", section: "overview", snapshot, pollSeconds: 60, refreshedAt: "2026-11-13T00:00:00Z" });
    expect(html).toContain('data-section="kit-runs"');
    expect(html).toContain('aria-current="page">Overview');
    expect(html).toContain("Blocked kit runs");
    expect(html).toContain("pill-negative");
    const laser = renderWorkspace({ workspaceId: "ws-1", section: "machines", snapshot, pollSeconds: 60, refreshedAt: "" });
    expect(laser).toContain("Laser &lt;1&gt;");
    expect(laser).not.toContain("<1>");
  });

  it("shows honest empty states and errors", () => {
    const html = renderWorkspace({ workspaceId: "ws-1", section: "evidence", snapshot: { projects: [], kitRuns: [] }, pollSeconds: 60, refreshedAt: "" }, { error: "FabForge is <down>" });
    expect(html).toContain("No artifacts in this workspace.");
    expect(html).toContain('role="alert">FabForge is &lt;down&gt;');
  });
});

describe("job review renderer", () => {
  it("offers approval first, then machine selection, then artifact verification", () => {
    expect(review().workflow!.actions![0]!.id).toBe("approve");
    expect(renderJobReview(review())).toContain('data-action="approve"');
    const execute = renderJobReview(review({ approved: true }));
    expect(execute).toContain('data-action="execute"');
    expect(execute).toContain('<option value="laser-1" selected>Laser &lt;1&gt; · online</option>');
    const verify = renderJobReview(review({ approved: true, executionRequested: true }));
    expect(verify).toContain('data-action="verify"');
    expect(verify).toContain('value="out/panel.dxf"');
    expect(renderJobReview(review({ approved: true, executionRequested: true, verificationStatus: "passed" }))).toContain('data-action="reapprove"');
  });

  it("disables actions while busy and handles a workspace without jobs", () => {
    expect(renderJobReview(review(), { busy: true })).toContain('data-action="approve" disabled');
    const { jobId: _job, workflow: _workflow, ...empty } = review();
    expect(renderJobReview({ ...empty, jobs: [] })).toContain("FabForge has no manufacturing jobs to review in this workspace.");
  });
});
