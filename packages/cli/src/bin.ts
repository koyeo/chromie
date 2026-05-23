#!/usr/bin/env node
import { Command } from "commander";

import { registerDevtoolsCommand } from "./devtools/index.js";

const program = new Command();

program
  .name("chromie")
  .description("chromie CLI")
  .version("0.0.0")
  .option("--output-format <format>", "Output format: text | json", "text")
  .showHelpAfterError();

await registerDevtoolsCommand(program);
await program.parseAsync(process.argv);
