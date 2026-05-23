#!/usr/bin/env node
import { Command } from "commander";

import { registerBrowserCommand } from "./browser/cli.js";
import { runDaemon } from "./browser/daemon.js";
import { registerDevtoolsCommand } from "./devtools/index.js";

// Internal route: spawned by `chromie browser start` to run the daemon process.
// Must be checked BEFORE commander runs, and must NOT call process.exit afterwards
// — the unix socket listener inside runDaemon keeps the event loop alive on its own.
if (process.argv[2] === "__daemon") {
  await runDaemon(process.argv.slice(3));
} else {
  const program = new Command();

  program
    .name("chromie")
    .description("chromie CLI")
    .version("0.0.0")
    .option(
      "--browser <id>",
      "Route the command to a persistent browser daemon (see `chromie browser start`)",
    )
    .option("--output-format <format>", "Output format: text | json", "text")
    .showHelpAfterError();

  registerBrowserCommand(program);
  await registerDevtoolsCommand(program);
  await program.parseAsync(process.argv);
}
