# T3 Code FabForge plugin

A T3 Code plugin for FabForge, a manufacturing IDE for 3D printing, laser and plasma cutting, CNC, materials, machine state and production evidence. It is an MCP server (manifest v2) with MCP Apps views, and it talks to FabForge's workspace-scoped fabrication API.

## What it adds

- **Panels:** Fabrication projects (project), Kit runs (thread) and Job verification (thread), each with a command to open it.
- **Tools for agents and views:**
  - `fabforge_workspace`: projects, kit runs, jobs, machines, materials and artifacts, optionally one section such as `laser`, `cnc` or `evidence`.
  - `fabforge_job_review`: one job's process control, compatible machines and review stage.
  - `fabforge_job_execute`: sends an approved job to a compatible, available machine.
  - `fabforge_artifact_verify`: checks the job's output artifact.
- **Human approval:** only a person can approve a job, from the job review view (`fabforge_job_approve` is hidden from agents). Execution fails until the job is approved, and each approval allows one run: approve the job again to rerun it.

## Settings

Set these under Settings → Tools → fabforge:

| Variable | Purpose |
|---|---|
| `FABFORGE_URL` | FabForge endpoint (default `https://fabforge.forgegraf.com`) |
| `FABFORGE_TOKEN` | FabForge token (secret) |
| `FABFORGE_WORKSPACE_ID` | Workspace every request is scoped to |
| `FABFORGE_POLL_SECONDS` | How often open views refresh (15–3600, default 60) |
| `FABFORGE_EXECUTE_COMMAND` | Optional local command used instead of the execute API; gets `--job-id`, `--process`, `--machine-id` |
| `FABFORGE_VERIFY_COMMAND` | Optional local command used instead of the verify API; gets `--job-id`, `--artifact`, `--expected`; exit 0 passes |
| `FABFORGE_PLUGIN_STATE_PATH` | Optional SQLite file for job review state shared by all plugin processes |

## Development

```sh
bun install
bun test
bun run typecheck
bun run mcp       # the stdio server
bun run inspect   # MCP Inspector against it
```

See [docs/manifest-v2.md](docs/manifest-v2.md) for the manifest, the tool list and the v1 → v2 mapping.
