import { homedir } from "node:os";
import { join } from "node:path";

import { normalizePollingSeconds } from "./fabforge.ts";

// The v1 settings (fabforge.endpoint, fabforge.token, fabforge.workspace,
// fabforge.polling-seconds) map onto these env vars, declared under
// mcpServer.transport.env in t3-plugin.json so T3's Tools registry collects
// them and redacts the token.
export type FabForgeConfig = {
  readonly endpoint: string;
  readonly token: string;
  readonly workspaceId: string;
  readonly pollSeconds: number;
  /** Optional local command prefixes that replace the FabForge execute/verify API calls. */
  readonly executeCommand: readonly string[];
  readonly verifyCommand: readonly string[];
};

export const DEFAULT_FABFORGE_URL = "https://fabforge.forgegraf.com";

export class FabForgeConfigError extends Error {}

// Read per tool call, not at startup: the server must still start and list its
// tools when settings are missing, and each call explains what to fill in.
export function loadConfig(env: Record<string, string | undefined> = process.env): FabForgeConfig {
  const token = env.FABFORGE_TOKEN?.trim();
  const workspaceId = env.FABFORGE_WORKSPACE_ID?.trim();
  const missing = [token ? undefined : "FABFORGE_TOKEN", workspaceId ? undefined : "FABFORGE_WORKSPACE_ID"].filter(Boolean);
  if (missing.length) {
    throw new FabForgeConfigError(`FabForge is not configured: set ${missing.join(" and ")} in the FabForge plugin's settings (Settings → Tools → fabforge).`);
  }
  const raw = env.FABFORGE_URL?.trim() || DEFAULT_FABFORGE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FabForgeConfigError(`FABFORGE_URL is not a valid URL (e.g. ${DEFAULT_FABFORGE_URL}).`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FabForgeConfigError("FABFORGE_URL must be an http(s) URL.");
  const seconds = Number(env.FABFORGE_POLL_SECONDS);
  return {
    endpoint: url.href.replace(/\/+$/, ""),
    token: token!,
    workspaceId: workspaceId!,
    pollSeconds: normalizePollingSeconds(env.FABFORGE_POLL_SECONDS?.trim() && Number.isFinite(seconds) ? seconds : undefined),
    executeCommand: words(env.FABFORGE_EXECUTE_COMMAND),
    verifyCommand: words(env.FABFORGE_VERIFY_COMMAND),
  };
}

// Split on whitespace and run without a shell, as v1 did.
function words(value: string | undefined): readonly string[] {
  return value?.trim().split(/\s+/u).filter(Boolean) ?? [];
}

// T3 does not hand plugins a data directory, so the shared workflow state
// defaults to the XDG state dir and never to T3's own userdata.
export function statePath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.FABFORGE_PLUGIN_STATE_PATH?.trim();
  if (explicit) return explicit;
  const base = env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "t3code-fabforge-plugin", "state.sqlite");
}
