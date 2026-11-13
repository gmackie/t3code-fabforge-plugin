import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { FabForgeWorkflowState } from "./fabforge.ts";

// Job review state (approval, execution request, verification result) per
// workspace job. T3 runs one stdio copy per agent session plus one in its pool,
// so a human's approval in a panel and an agent's execute call can land in
// different processes: the state lives in one SQLite file every copy opens.
export type WorkflowStore = {
  get(workspaceId: string, jobId: string): Promise<FabForgeWorkflowState>;
  save(workspaceId: string, jobId: string, state: FabForgeWorkflowState): Promise<void>;
  // Atomically uses up an approval: true only when the job is approved and not
  // yet sent, so one human approval allows exactly one machine run.
  claimExecution(workspaceId: string, jobId: string): Promise<boolean>;
  // Gives the approval back when the machine never got the job.
  releaseExecution(workspaceId: string, jobId: string): Promise<void>;
};

export function sqliteWorkflowStore(path: string): WorkflowStore {
  let db: Database | undefined;
  // Opened on first use so an unwritable state dir only affects the job review tools.
  const open = () => {
    if (db) return db;
    mkdirSync(dirname(path), { recursive: true });
    const next = new Database(path, { create: true });
    next.exec("PRAGMA journal_mode = WAL");
    next.exec("PRAGMA busy_timeout = 5000");
    next.exec("CREATE TABLE IF NOT EXISTS fabforge_job_review (workspace_id TEXT NOT NULL, job_id TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, job_id))");
    db = next;
    return next;
  };
  return {
    async get(workspaceId, jobId) {
      const row = open().query<{ state: string }, [string, string]>("SELECT state FROM fabforge_job_review WHERE workspace_id = ? AND job_id = ?").get(workspaceId, jobId);
      return row ? sanitize(JSON.parse(row.state)) : {};
    },
    async save(workspaceId, jobId, state) {
      open()
        .query("INSERT INTO fabforge_job_review (workspace_id, job_id, state, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, job_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at")
        .run(workspaceId, jobId, JSON.stringify(sanitize(state)), new Date().toISOString());
    },
    async claimExecution(workspaceId, jobId) {
      // One conditional UPDATE, so two copies racing on the same approval
      // cannot both pass.
      const { changes } = open()
        .query("UPDATE fabforge_job_review SET state = json_set(state, '$.executionRequested', json('true')), updated_at = ? WHERE workspace_id = ? AND job_id = ? AND json_extract(state, '$.approved') = 1 AND COALESCE(json_extract(state, '$.executionRequested'), 0) = 0")
        .run(new Date().toISOString(), workspaceId, jobId);
      return changes === 1;
    },
    async releaseExecution(workspaceId, jobId) {
      open()
        .query("UPDATE fabforge_job_review SET state = json_set(state, '$.executionRequested', json('false')), updated_at = ? WHERE workspace_id = ? AND job_id = ? AND json_extract(state, '$.executionRequested') = 1 AND json_extract(state, '$.verificationStatus') IS NULL")
        .run(new Date().toISOString(), workspaceId, jobId);
    },
  };
}

export function memoryWorkflowStore(): WorkflowStore {
  const states = new Map<string, FabForgeWorkflowState>();
  const key = (workspaceId: string, jobId: string) => `${workspaceId}\u0000${jobId}`;
  return {
    get: async (workspaceId, jobId) => states.get(key(workspaceId, jobId)) ?? {},
    save: async (workspaceId, jobId, state) => void states.set(key(workspaceId, jobId), sanitize(state)),
    async claimExecution(workspaceId, jobId) {
      const state = states.get(key(workspaceId, jobId));
      if (!state?.approved || state.executionRequested) return false;
      states.set(key(workspaceId, jobId), { ...state, executionRequested: true });
      return true;
    },
    async releaseExecution(workspaceId, jobId) {
      const state = states.get(key(workspaceId, jobId));
      if (state?.executionRequested && !state.verificationStatus) states.set(key(workspaceId, jobId), { ...state, executionRequested: false });
    },
  };
}

// Missing or unexpected fields start safely unapproved.
function sanitize(value: unknown): FabForgeWorkflowState {
  const state = (value ?? {}) as Record<string, unknown>;
  const verification = state.verificationStatus;
  return {
    approved: state.approved === true,
    executionRequested: state.executionRequested === true,
    ...(verification === "pending" || verification === "passed" || verification === "failed" ? { verificationStatus: verification } : {}),
  };
}
