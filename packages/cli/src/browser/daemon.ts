import fs from "node:fs/promises";
import net from "node:net";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createInProcessMcp } from "../mcp/in-process.js";
import { cleanupFiles, ensureDir, writeMeta } from "./manager.js";
import { metaPath, socketPath, type BrowserMeta } from "./paths.js";
import {
  encodeMessage,
  type DaemonRequest,
  type DaemonResponse,
} from "./protocol.js";

interface DaemonArgs {
  id: string;
  name: string | null;
  pageIdRouting: boolean;
  idleTimeoutMs: number;
}

const VERSION = "0.0.0";

function parseDaemonArgs(argv: string[]): DaemonArgs {
  const opts: DaemonArgs = {
    id: "",
    name: null,
    pageIdRouting: false,
    idleTimeoutMs: 30 * 60 * 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--id") opts.id = String(argv[++i]);
    else if (a === "--name") opts.name = String(argv[++i]);
    else if (a === "--pageIdRouting") opts.pageIdRouting = true;
    else if (a === "--idle-timeout-ms") opts.idleTimeoutMs = Number(argv[++i]);
  }
  if (!opts.id) throw new Error("--id is required");
  return opts;
}

export async function runDaemon(argv: string[]): Promise<void> {
  const opts = parseDaemonArgs(argv);
  await ensureDir();

  const sockPath = socketPath(opts.id);
  await fs.rm(sockPath, { force: true });

  const { client, close: closeMcp } = await createInProcessMcp({
    pageIdRouting: opts.pageIdRouting,
  });

  let lastActivity = Date.now();
  let shuttingDown = false;

  const cleanupAndExit = async (code: number): Promise<never> => {
    if (shuttingDown) return new Promise(() => {}) as never;
    shuttingDown = true;
    server.close();
    await closeMcp().catch(() => {});
    await cleanupFiles(opts.id).catch(() => {});
    process.exit(code);
  };

  const dispatch = async (req: DaemonRequest): Promise<unknown> => {
    lastActivity = Date.now();
    switch (req.op) {
      case "ping":
        return { pid: process.pid, version: VERSION };
      case "list":
        return await client.listTools();
      case "tool":
        return await client.callTool({ name: req.name, arguments: req.args });
      case "shutdown":
        setImmediate(() => {
          void cleanupAndExit(0);
        });
        return { stopping: true };
      default:
        throw new Error(`Unknown op: ${(req as { op: string }).op}`);
    }
  };

  const handleConnection = (conn: net.Socket): void => {
    let buf = "";
    const send = (res: DaemonResponse): void => {
      conn.write(encodeMessage(res));
    };
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: DaemonRequest;
        try {
          req = JSON.parse(line) as DaemonRequest;
        } catch (e) {
          send({ ok: false, error: `Bad request: ${(e as Error).message}` });
          continue;
        }
        void (async () => {
          try {
            const data = await dispatch(req);
            send({ ok: true, data });
          } catch (e) {
            send({ ok: false, error: (e as Error).message });
          }
        })();
      }
    });
    conn.on("error", () => {});
  };

  const server = net.createServer(handleConnection);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => resolve());
  });

  const meta: BrowserMeta = {
    id: opts.id,
    name: opts.name,
    pid: process.pid,
    socket: sockPath,
    createdAt: new Date().toISOString(),
    pageIdRouting: opts.pageIdRouting,
    version: VERSION,
  };
  await writeMeta(meta);

  // Idle timeout — exit if no activity for the configured duration.
  if (opts.idleTimeoutMs > 0) {
    setInterval(() => {
      if (Date.now() - lastActivity > opts.idleTimeoutMs) {
        void cleanupAndExit(0);
      }
    }, Math.min(opts.idleTimeoutMs, 30_000)).unref();
  }

  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => void cleanupAndExit(0));
  }

  // Signal readiness to the parent process. Parent reads this line and unrefs.
  process.stdout.write(`READY ${opts.id} ${sockPath}\n`);
}
