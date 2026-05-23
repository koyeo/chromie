import type { Command } from "commander";

import { registerToolCommands } from "./registry.js";

export async function registerDevtoolsCommand(program: Command): Promise<void> {
  const devtools = program
    .command("devtools")
    .description("Drive Chrome via chrome-devtools-mcp tools (in-process MCP)")
    .showHelpAfterError();
  await registerToolCommands(devtools);
}
