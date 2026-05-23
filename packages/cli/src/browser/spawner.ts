import { spawn } from "node:child_process";
import path from "node:path";

export interface SpawnOptions {
  id: string;
  name: string | null;
  pageIdRouting: boolean;
  idleTimeoutMs: number;
}

export interface SpawnResult {
  pid: number;
}

const READY_TIMEOUT_MS = 30_000;

function resolveBinPath(): string {
  // process.argv[1] is the entry script that's currently running — i.e. our bin.js.
  // The shim installed by `make install` execs `node /abs/path/to/dist/bin.js`,
  // so this is always an absolute path.
  const argv1 = process.argv[1];
  if (!argv1) throw new Error("Cannot determine bin path from process.argv[1]");
  return path.resolve(argv1);
}

export async function spawnDaemon(opts: SpawnOptions): Promise<SpawnResult> {
  const binPath = resolveBinPath();
  const args = [
    binPath,
    "__daemon",
    "--id",
    opts.id,
    "--idle-timeout-ms",
    String(opts.idleTimeoutMs),
  ];
  if (opts.name) args.push("--name", opts.name);
  if (opts.pageIdRouting) args.push("--pageIdRouting");

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise<SpawnResult>((resolve, reject) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => {
        try {
          child.kill("SIGTERM");
        } catch {}
        reject(
          new Error(
            `Daemon did not signal READY within ${READY_TIMEOUT_MS / 1000}s.\nstderr: ${stderrBuf}`,
          ),
        );
      });
    }, READY_TIMEOUT_MS);

    child.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf-8");
      const nl = stdoutBuf.indexOf("\n");
      if (nl < 0) return;
      const first = stdoutBuf.slice(0, nl);
      if (!first.startsWith("READY ")) {
        settle(() => {
          clearTimeout(timer);
          reject(new Error(`Unexpected daemon output: ${first}`));
        });
        return;
      }
      settle(() => {
        clearTimeout(timer);
        child.unref();
        // Destroy stdio so the pipes do not keep the parent's event loop alive.
        // (.unref exists at runtime on the underlying Pipe but isn't on Readable's typing.)
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolve({ pid: child.pid! });
      });
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf-8");
    });

    child.on("error", (e) => {
      settle(() => {
        clearTimeout(timer);
        reject(e);
      });
    });

    child.on("exit", (code) => {
      settle(() => {
        clearTimeout(timer);
        reject(
          new Error(
            `Daemon exited before ready (code=${code}).\nstderr: ${stderrBuf}`,
          ),
        );
      });
    });
  });
}
