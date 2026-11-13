#!/usr/bin/env bun
// Stdio entry point for the MCP-native FabForge plugin (manifest v2 `mcpServer`).
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createFabForgeMcpServer } from "./server.ts";

await createFabForgeMcpServer().connect(new StdioServerTransport());
