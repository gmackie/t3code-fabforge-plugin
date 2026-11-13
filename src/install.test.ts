import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import manifest from "../t3-plugin.json";

it("launches the installed manifest from another directory and serves its panels", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "fabforge-install-"));
  const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  // Unconfigured on purpose: the server must start and explain what is missing.
  const transport = new StdioClientTransport({
    command: manifest.mcpServer.transport.command,
    args: manifest.mcpServer.transport.args.map((arg) => arg.replaceAll("${pluginRoot}", root)),
    cwd,
    env: { PATH: process.env.PATH ?? "", FABFORGE_PLUGIN_STATE_PATH: join(cwd, "state.sqlite") },
  });
  const client = new Client({ name: "installation-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools.sort()).toEqual(["fabforge_artifact_verify", "fabforge_job_approve", "fabforge_job_execute", "fabforge_job_review", "fabforge_workspace"]);
    const resources = (await client.listResources()).resources;
    for (const panel of manifest.contributes.panels) {
      expect(resources.some((resource) => resource.uri === panel.resourceUri)).toBe(true);
      expect(tools).toContain(panel.tool.name);
      const view = await client.readResource({ uri: panel.resourceUri });
      expect(view.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
      expect(view.contents[0]).toHaveProperty("text", expect.stringContaining("ui/initialize"));
    }
    const unconfigured = await client.callTool({ name: "fabforge_workspace", arguments: { section: "projects" } });
    expect(unconfigured).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("FabForge is not configured") }] });
  } finally {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
