// The v1 navigation entries become sections of the workspace view. Each
// section is a set of lists derived from one workspace snapshot.
import { buildCockpitViewModel, buildProcessControl, type FabForgeSnapshot } from "./fabforge.ts";

export const SECTIONS = ["overview", "projects", "printing", "laser", "plasma", "cnc", "materials", "machines", "work-orders", "kit-runs", "evidence"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_TITLES: Record<Section, string> = {
  overview: "Overview",
  projects: "Projects",
  printing: "3D printing",
  laser: "Laser cutting",
  plasma: "Plasma cutting",
  cnc: "CNC",
  materials: "Materials",
  machines: "Machines",
  "work-orders": "Work orders",
  "kit-runs": "Kit runs",
  evidence: "Evidence",
};

export type Tone = "neutral" | "positive" | "warning" | "negative";
export type SectionItem = { id: string; title: string; detail?: string; status?: string; tone: Tone };
export type SectionGroup = { title: string; items: readonly SectionItem[] };
export type SectionMetric = { id: string; title: string; value: number; tone: Tone };

const PROCESSES: Partial<Record<Section, readonly string[]>> = { printing: ["fdm", "resin"], laser: ["laser"], plasma: ["plasma"], cnc: ["cnc"] };

export function tone(status: string): Tone {
  const value = status.toLowerCase();
  if (["complete", "completed", "done", "passed", "online", "idle", "ready", "available", "in stock"].includes(value)) return "positive";
  if (["blocked", "failed", "error", "offline", "out of stock", "out"].includes(value)) return "negative";
  if (["cancelled", "unknown"].includes(value)) return "neutral";
  return "warning";
}

export function sectionMetrics(snapshot: FabForgeSnapshot): readonly SectionMetric[] {
  const { metrics } = buildCockpitViewModel(snapshot);
  return [
    { id: "projects", title: "Projects", value: metrics.projects, tone: "neutral" },
    { id: "active-kit-runs", title: "Active kit runs", value: metrics.activeKitRuns, tone: "neutral" },
    { id: "blocked-kit-runs", title: "Blocked kit runs", value: metrics.blockedKitRuns, tone: metrics.blockedKitRuns === 0 ? "positive" : "negative" },
    { id: "jobs", title: "Jobs", value: snapshot.jobs?.length ?? 0, tone: "neutral" },
    { id: "machines-online", title: "Machines ready", value: (snapshot.machines ?? []).filter((machine) => tone(machine.status) === "positive").length, tone: "neutral" },
  ];
}

export function sectionGroups(snapshot: FabForgeSnapshot, section: Section): readonly SectionGroup[] {
  const jobs = (filter?: readonly string[]) =>
    (snapshot.jobs ?? [])
      .filter((job) => !filter || filter.includes(job.process.toLowerCase()))
      .map((job) => {
        const control = buildProcessControl(job);
        const detail = [job.process, job.machineId ? `machine ${job.machineId}` : undefined, job.material ? `material ${job.material}` : undefined, control.artifactKinds.length ? `expects ${control.artifactKinds.join("/")}` : undefined].filter(Boolean).join(" · ");
        return { id: job.id, title: job.id, detail, status: job.status, tone: tone(job.status) };
      });
  const machines = (filter?: readonly string[]) =>
    (snapshot.machines ?? []).filter((machine) => !filter || filter.includes(machine.process.toLowerCase())).map((machine) => ({ id: machine.id, title: machine.name, detail: `${machine.process} · ${machine.id}`, status: machine.status, tone: tone(machine.status) }));
  const materials = (filter?: readonly string[]) =>
    (snapshot.materials ?? []).filter((material) => !filter || filter.includes(material.process.toLowerCase())).map((material) => ({ id: material.id, title: material.name, detail: material.process, status: material.stock, tone: tone(material.stock) }));
  const kitRuns = () => snapshot.kitRuns.map((run) => ({ id: run.id, title: run.id, status: run.status, tone: tone(run.status) }));
  const projects = () => snapshot.projects.map((project) => ({ id: project.id, title: project.name, detail: project.id, tone: "neutral" as const }));
  const artifacts = () =>
    (snapshot.artifacts ?? []).map((artifact) => ({ id: artifact.id, title: artifact.path, detail: [artifact.kind, `job ${artifact.jobId}`, artifact.detail].filter(Boolean).join(" · "), status: artifact.status, tone: tone(artifact.status) }));

  const processes = PROCESSES[section];
  if (processes) {
    return [
      { title: "Jobs", items: jobs(processes) },
      { title: "Machines", items: machines(processes) },
      { title: "Materials", items: materials(processes) },
    ];
  }
  switch (section) {
    case "projects":
      return [{ title: "Projects", items: projects() }];
    case "materials":
      return [{ title: "Materials", items: materials() }];
    case "machines":
      return [{ title: "Machines", items: machines() }];
    case "work-orders":
      return [{ title: "Jobs", items: jobs() }];
    case "kit-runs":
      return [{ title: "Kit runs", items: kitRuns() }];
    case "evidence":
      return [{ title: "Artifacts", items: artifacts() }];
    default:
      return [
        { title: "Kit runs", items: kitRuns().slice(0, 8) },
        { title: "Jobs", items: jobs().slice(0, 8) },
      ];
  }
}
