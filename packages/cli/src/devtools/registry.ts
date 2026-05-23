import type { Command } from "commander";

import { renderToolResult, type OutputFormat } from "../output.js";
import { closeMcpClient, getMcpClient } from "./client.js";

interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  enum?: unknown[];
}

interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

function coerce(value: unknown, prop: JsonSchema): unknown {
  if (value === undefined || value === null) return undefined;
  const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  if (type === "number" || type === "integer") {
    if (typeof value === "string") {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`Expected number, got "${value}"`);
      return n;
    }
    return value;
  }
  if (type === "boolean") {
    if (typeof value === "string") {
      if (value === "true") return true;
      if (value === "false") return false;
      throw new Error(`Expected boolean ("true"|"false"), got "${value}"`);
    }
    return Boolean(value);
  }
  if (type === "array" || type === "object") {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (e) {
        throw new Error(
          `Expected JSON for ${type}, failed to parse: ${(e as Error).message}`,
        );
      }
    }
    return value;
  }
  // type === "string" or unspecified
  return value;
}

function describeProp(prop: JsonSchema): string {
  const desc = prop.description ?? "";
  const type = Array.isArray(prop.type) ? prop.type.join("|") : prop.type;
  const meta: string[] = [];
  if (type) meta.push(type);
  if (prop.enum) meta.push(`one of: ${prop.enum.join(", ")}`);
  if (prop.default !== undefined) meta.push(`default: ${JSON.stringify(prop.default)}`);
  const metaStr = meta.length ? ` [${meta.join("; ")}]` : "";
  return `${desc}${metaStr}`;
}

export async function registerToolCommands(devtools: Command): Promise<void> {
  const client = await getMcpClient();
  const { tools } = (await client.listTools()) as { tools: ToolInfo[] };

  for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    const schema = tool.inputSchema ?? {};
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const requiredKeys = Object.keys(props).filter((k) => required.has(k));
    const optionalKeys = Object.keys(props).filter((k) => !required.has(k));

    const cmd = devtools.command(tool.name).description(tool.description ?? "");

    for (const key of requiredKeys) {
      cmd.argument(`<${key}>`, describeProp(props[key]!));
    }
    for (const key of optionalKeys) {
      cmd.option(`--${key} <value>`, describeProp(props[key]!));
    }

    cmd.action(async (...actionArgs: unknown[]) => {
      // commander v12 action signature: (...positionals, options, command)
      const command = actionArgs[actionArgs.length - 1] as Command;
      const optsObj = (actionArgs[actionArgs.length - 2] ?? {}) as Record<string, unknown>;
      const positionals = actionArgs.slice(0, requiredKeys.length);

      const toolArgs: Record<string, unknown> = {};
      requiredKeys.forEach((key, i) => {
        const coerced = coerce(positionals[i], props[key]!);
        if (coerced !== undefined) toolArgs[key] = coerced;
      });
      for (const key of optionalKeys) {
        if (key in optsObj) {
          const coerced = coerce(optsObj[key], props[key]!);
          if (coerced !== undefined) toolArgs[key] = coerced;
        }
      }

      const format = (command.parent?.parent?.opts()["outputFormat"] ?? "text") as OutputFormat;

      let exitCode = 0;
      try {
        const result = await client.callTool({
          name: tool.name,
          arguments: toolArgs,
        });
        console.log(renderToolResult(result as Parameters<typeof renderToolResult>[0], format));
      } catch (err) {
        exitCode = 1;
        console.error(err instanceof Error ? err.message : String(err));
      }
      // Force exit: Puppeteer keeps a CDP socket open after McpServer close,
      // which keeps the Node event loop alive. We're done with the command,
      // so terminate the whole process instead of waiting on the browser.
      await closeMcpClient().catch(() => {});
      process.exit(exitCode);
    });
  }
}
