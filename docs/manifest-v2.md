# FabForge manifest v2 (T3CODE-75)

`t3-plugin.json` follows the MCP-native plugin design approved on T3CODE-74, ported the same way as the Bob pilot (gmackie/t3code-bob-plugin v0.2.1). T3 loads this manifest into its server-owned MCP registry.

## Shape

- `mcpServer` reuses `McpServerConfig` and `McpServerVariable` from Settings → Tools (`packages/contracts/src/agentTools.ts`):
  - `name`: `fabforge`.
  - `transport`: stdio, `bun ${pluginRoot}/src/mcp.ts`, with `env` as `McpServerVariable[]`.
  - `FABFORGE_URL` (default `https://fabforge.forgegraf.com`), `FABFORGE_TOKEN` (`sensitive`), `FABFORGE_WORKSPACE_ID`, `FABFORGE_POLL_SECONDS` (default 60, clamped to 15–3600), the optional `FABFORGE_EXECUTE_COMMAND` / `FABFORGE_VERIFY_COMMAND`, and the optional `FABFORGE_PLUGIN_STATE_PATH`.
- `contributes.panels[]`. Each panel names the tool T3 runs when it opens, so a panel behaves like the same view inline after a tool call:
  - `fabforge-projects` (`scope: project`) renders `ui://fabforge/workspace.html` with `fabforge_workspace {section: "projects"}`.
  - `fabforge-kit-runs` (`scope: thread`) renders `ui://fabforge/workspace.html` with `fabforge_workspace {section: "kit-runs"}`.
  - `fabforge-job-verification` (`scope: thread`) renders `ui://fabforge/job-review.html` with `fabforge_job_review {}`.
- `contributes.commands[]` open each panel.
- `t3Tools` is `[]`. FabForge never calls back into T3, and v1 had no T3 grant.

There is no `runtime`, `workflows`, `hooks`, `settings`, `settingsPanels`, or capability request.

## Tools

| Tool | Visibility | What it does |
|---|---|---|
| `fabforge_workspace` | `["model", "app"]` | Workspace snapshot (projects, kit runs, jobs, machines, materials, artifacts), optionally narrowed to a `section`. Renders `ui://fabforge/workspace.html`. Read-only. |
| `fabforge_job_review` | `["model", "app"]` | One job's process control, expected artifacts, compatible machines, approval/execution/verification state and next action, plus the workspace verification roll-up. Renders `ui://fabforge/job-review.html`. Read-only. |
| `fabforge_job_approve` | `["app"]` | Records a human's approval for one job. Only the job review view can call it. |
| `fabforge_job_execute` | `["model", "app"]` | Sends an approved job to a machine after `validateExecutionTarget` (same process, machine online/idle/ready). `FABFORGE_EXECUTE_COMMAND` if set, otherwise `POST /api/fabrication/v0/jobs/{id}/execute`. Each approval allows one run. Only an explicit `accepted`/`queued`/`running`/`completed` status with no `error` counts as sent; anything else is an error and gives the approval back. |
| `fabforge_artifact_verify` | `["model", "app"]` | Verifies an executed job's artifact against the kinds its process expects. `FABFORGE_VERIFY_COMMAND` if set (exit 0 passes, non-zero fails), otherwise `POST /api/fabrication/v0/jobs/{id}/verify`. Only an explicit pass counts as passed; an unrecognised answer is recorded as pending. |

Every call goes to FabForge's workspace-scoped fabrication API (`/api/fabrication/v0/*?workspaceId=…`) with the bearer token, through the v1 domain module `src/fabforge.ts`. Calls time out after 15s, local commands after 120s. 5xx responses become "FabForge is temporarily unavailable", and no error includes a URL or a response body beyond FabForge's own one-line message on a 4xx. With `FABFORGE_TOKEN` or `FABFORGE_WORKSPACE_ID` missing, the server still starts and every tool says which setting to fill in.

## v1 → v2 mapping

The v1 manifest is the last commit on `master` before this port (23a9604).

| v1 | v2 |
|---|---|
| `runtime` (managed-app, `bun src/stdio.ts`, RPC `surface.get`/`panel.get`/`workflow.get`/`action.execute`) | `mcpServer.transport` (stdio, `bun ${pluginRoot}/src/mcp.ts`) |
| `navigation[fabforge.projects … fabforge.evidence]` (10 entries) | Sections of `ui://fabforge/workspace.html` and the `section` argument of `fabforge_workspace` (`projects`, `printing`, `laser`, `plasma`, `cnc`, `materials`, `machines`, `work-orders`, `kit-runs`, `evidence`, plus `overview`) |
| `panels[fabforge.projects]` (project) | `panels[fabforge-projects]`, `scope: project` |
| `panels[fabforge.kit-runs]` (thread.sidePanel, "serial console") | `panels[fabforge-kit-runs]`, `scope: thread`, a kit-run status list (see below) |
| `panels[fabforge.job-verification]` (thread.main) | `panels[fabforge-job-verification]`, `scope: thread`, tool `fabforge_job_review` |
| `workflows[fabforge.job-review]` (thread.main) | Tool `fabforge_job_review` with its own `ui://fabforge/job-review.html` view |
| `action.execute` `approve` / `execute` / `verify` | Tools `fabforge_job_approve` (app-only), `fabforge_job_execute`, `fabforge_artifact_verify` |
| `action.execute` `fabforge.refresh-verification` | The view's Refresh button, which re-runs `fabforge_job_review` |
| `action.execute` `fabforge.open-console` | **Removed**, see below |
| `settings[fabforge.endpoint, fabforge.token, fabforge.workspace, fabforge.polling-seconds]`, `settingsPanels[fabforge.connection]` | `FABFORGE_URL`, `FABFORGE_TOKEN` (`sensitive`), `FABFORGE_WORKSPACE_ID`, `FABFORGE_POLL_SECONDS` in `mcpServer.transport.env`. Views refresh on that interval while visible. |
| `T3_PLUGIN_EXECUTE_COMMAND`, `T3_PLUGIN_VERIFY_COMMAND` (undeclared env) | Declared as `FABFORGE_EXECUTE_COMMAND`, `FABFORGE_VERIFY_COMMAND` |
| `T3_PLUGIN_STATE_FILE` (single global workflow state) | Per-job state in a shared SQLite file, `FABFORGE_PLUGIN_STATE_PATH` (see below) |
| `T3_PLUGIN_SNAPSHOT` (seed snapshot) | Dropped: every tool reads FabForge live |
| `capabilities.secrets.read` (`FABFORGE_TOKEN`) | `sensitive` variable |
| `capabilities.network.connect` (`fabforge.forgegraf.com`) | Dropped: the server process makes the calls, and views go through `tools/call` |
| `capabilities.ui.embed` | Implied by `panels` |
| `hooks` (`turn.settled`, `runtime.error`) | **Removed**, see below |

## Removed v1 features

- **Hooks (`turn.settled`, `runtime.error`).** Manifest v2 has no hooks (T3CODE-74 D4). The v1 runtime never handled a hook message either, so no behaviour is lost. Views refresh on `FABFORGE_POLL_SECONDS` and on demand instead.
- **The "serial console" and `fabforge.open-console`.** v1's kit-run panel synthesized console lines from kit-run statuses, always reported the station as connected, and its "Open console" action returned "Station console opened by FabForge." without doing anything. FabForge's API exposes no station console, so the thread panel now shows kit runs with their real statuses and the fake console and action are gone.
- **The polling coordinator at runtime.** `createPollingCoordinator` stays in the domain module and its tests, but the stateless MCP processes no longer poll in the background; views refresh while they are open.

## State

T3 runs one stdio copy per agent session plus one in its pool, so a human's approval in a panel (pool copy) and an agent's `fabforge_job_execute` (session copy) can land in different processes. Approval, execution and verification state per workspace job lives in one SQLite file (WAL, `busy_timeout`) at `FABFORGE_PLUGIN_STATE_PATH`, default `$XDG_STATE_HOME/t3code-fabforge-plugin/state.sqlite`. `server.test.ts` covers approving in one copy and executing from another. Execute uses up the approval with one conditional SQLite `UPDATE` before it calls FabForge, so a repeated call, or two copies racing, cannot run a job twice on one approval. A definite failure (a rejected status, a 4xx/5xx, a non-zero command exit) gives the approval back. A timeout does not, because the machine may already have the job. Re-approving a job resets it to the execute step, which is how a job is rerun.

## Open questions

1. **Shared state file.** Like Bob, this depends on every copy seeing the same `HOME`/`XDG_STATE_HOME` (or the same `FABFORGE_PLUGIN_STATE_PATH`).
2. **FabForge API shape.** The execute and verify response fields (`status`, `verification`, `detail`, `id`/`reference`) come from the v1 domain module; FabForge's actual responses should be checked against them. Until then, execute treats any status other than accepted/queued/running/completed as a failure.
3. **Kit runs in a thread.** Kit runs are workspace-wide, not per thread. The panel stays thread-scoped to match v1's side panel.
