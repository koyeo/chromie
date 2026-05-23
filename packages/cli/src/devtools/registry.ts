import type { Command } from "commander";

import {
  callToolViaDaemon,
  resolveBrowserSocket,
} from "../browser/client.js";
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

// process.exit() doesn't wait for stdout's write queue. For small outputs the
// queue is empty by exit time; for large ones (~64KB+ on macOS pipes) we'd
// truncate at the kernel pipe-buffer boundary. Always drain before exit.
function writeAndDrain(stream: NodeJS.WriteStream, payload: string): Promise<void> {
  return new Promise((resolve) => {
    if (stream.write(payload)) resolve();
    else stream.once("drain", () => resolve());
  });
}

function rootOpts(cmd: Command): Record<string, unknown> {
  // commander: leaf action receives the Command; .parent walks up to root program.
  let cur: Command | null = cmd;
  while (cur?.parent) cur = cur.parent;
  return cur?.opts() ?? {};
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

      const root = rootOpts(command);
      const format = (root["outputFormat"] ?? "text") as OutputFormat;
      const browserId = root["browser"] as string | undefined;

      let exitCode = 0;
      try {
        let result: Parameters<typeof renderToolResult>[0];
        if (browserId) {
          const sockPath = await resolveBrowserSocket(browserId);
          result = await callToolViaDaemon(sockPath, tool.name, toolArgs);
        } else {
          result = (await client.callTool({
            name: tool.name,
            arguments: toolArgs,
          })) as Parameters<typeof renderToolResult>[0];
        }
        await writeAndDrain(process.stdout, renderToolResult(result, format) + "\n");
      } catch (e) {
        exitCode = 1;
        await writeAndDrain(
          process.stderr,
          (e instanceof Error ? e.message : String(e)) + "\n",
        );
      }
      // Always close the ephemeral in-process MCP (whether or not we used it
      // for the call — listTools() at startup did). Puppeteer keeps the event
      // loop alive otherwise.
      await closeMcpClient().catch(() => {});
      process.exit(exitCode);
    });
  }
}
