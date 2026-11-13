import { describe, expect, it } from "bun:test";

import { FabForgeConfigError, loadConfig, statePath } from "./config.ts";

describe("FabForge config", () => {
  it("defaults the endpoint and clamps the refresh interval", () => {
    expect(loadConfig({ FABFORGE_TOKEN: " t ", FABFORGE_WORKSPACE_ID: "w1", FABFORGE_POLL_SECONDS: "5" })).toEqual({
      endpoint: "https://fabforge.forgegraf.com",
      token: "t",
      workspaceId: "w1",
      pollSeconds: 15,
      executeCommand: [],
      verifyCommand: [],
    });
    expect(loadConfig({ FABFORGE_TOKEN: "t", FABFORGE_WORKSPACE_ID: "w1", FABFORGE_POLL_SECONDS: "abc", FABFORGE_EXECUTE_COMMAND: " fab  run " })).toMatchObject({ pollSeconds: 60, executeCommand: ["fab", "run"] });
  });

  it("names every missing or invalid setting", () => {
    expect(() => loadConfig({})).toThrow("set FABFORGE_TOKEN and FABFORGE_WORKSPACE_ID");
    expect(() => loadConfig({ FABFORGE_TOKEN: "t", FABFORGE_WORKSPACE_ID: "w", FABFORGE_URL: "ftp://x" })).toThrow(FabForgeConfigError);
  });

  it("keeps state outside T3's userdata", () => {
    expect(statePath({ XDG_STATE_HOME: "/state" })).toBe("/state/t3code-fabforge-plugin/state.sqlite");
    expect(statePath({ FABFORGE_PLUGIN_STATE_PATH: "/tmp/x.sqlite" })).toBe("/tmp/x.sqlite");
  });
});
