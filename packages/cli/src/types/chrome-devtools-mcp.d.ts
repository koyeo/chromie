// Ambient declarations for chrome-devtools-mcp@^1.0.1.
//
// Upstream ships JavaScript only (no `.d.ts`), so we describe just the surface
// the chromie CLI actually consumes. Anything broader belongs in upstream.

declare module "chrome-devtools-mcp" {
  import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

  export interface McpServerLike {
    server: Server;
  }

  export function createMcpServer(
    serverArgs: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<{ server: McpServerLike }>;

  export function logDisclaimers(args: Record<string, unknown>): void;

  export function buildFlag(category: string): string;
}

declare module "chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp-cli-options.js" {
  export function parseArguments(
    version: string,
    argv?: string[],
    env?: NodeJS.ProcessEnv,
  ): Record<string, unknown>;

  export const cliOptions: Record<string, unknown>;
}
