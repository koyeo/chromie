import type { Command } from "commander";
import { uuidv7 } from "uuidv7";

import { shutdownBrowser } from "./client.js";
import { isPidAlive, listBrowsers, resolveBrowser } from "./manager.js";
import { spawnDaemon } from "./spawner.js";

export function registerBrowserCommand(program: Command): void {
  const browser = program
    .command("browser")
    .description("Manage persistent browser daemons (each = one Chrome instance)");

  browser
    .command("start")
    .description("Start a new browser daemon. Prints the id on stdout.")
    .option("--name <name>", "Friendly name to address the browser by")
    .option(
      "--pageIdRouting",
      "Expose --pageId on page-scoped tools (otherwise the daemon uses an implicit selected page)",
    )
    .option(
      "--idle-timeout <minutes>",
      "Self-shutdown after this many minutes idle (0 = never)",
      "30",
    )
    .action(
      async (opts: {
        name?: string;
        pageIdRouting?: boolean;
        idleTimeout: string;
      }) => {
        const id = uuidv7();
        const idleMin = Number(opts.idleTimeout);
        if (Number.isNaN(idleMin) || idleMin < 0) {
          throw new Error(`Invalid --idle-timeout: ${opts.idleTimeout}`);
        }
        await spawnDaemon({
          id,
          name: opts.name ?? null,
          pageIdRouting: Boolean(opts.pageIdRouting),
          idleTimeoutMs: idleMin > 0 ? idleMin * 60 * 1000 : 0,
        });
        console.log(id);
        process.exit(0);
      },
    );

  browser
    .command("list")
    .description("List running browsers")
    .action(async () => {
      const all = await listBrowsers();
      if (!all.length) {
        console.log("(no running browsers)");
        process.exit(0);
      }
      const rows: string[][] = [["ID", "NAME", "PID", "STARTED", "ROUTING"]];
      for (const m of all) {
        rows.push([
          m.id,
          m.name ?? "-",
          String(m.pid),
          m.createdAt,
          m.pageIdRouting ? "on" : "off",
        ]);
      }
      const widths = rows[0]!.map((_, col) =>
        Math.max(...rows.map((r) => r[col]!.length)),
      );
      for (const r of rows) {
        console.log(r.map((cell, i) => cell.padEnd(widths[i]!)).join("  "));
      }
      process.exit(0);
    });

  browser
    .command("stop [id]")
    .description("Stop a browser by id/name/id-prefix. Use --all to stop every browser.")
    .option("--all", "Stop every running browser")
    .action(async (id: string | undefined, opts: { all?: boolean }) => {
      if (opts.all) {
        const all = await listBrowsers();
        for (const m of all) {
          try {
            await shutdownBrowser(m.socket);
            console.log(`stopped ${m.id}`);
          } catch (e) {
            console.error(`failed ${m.id}: ${(e as Error).message}`);
          }
        }
        process.exit(0);
      }
      if (!id) {
        console.error("Specify a browser id or pass --all");
        process.exit(1);
      }
      const meta = await resolveBrowser(id);
      try {
        await shutdownBrowser(meta.socket);
      } catch (e) {
        // Maybe the socket is stale but the process is alive (or dead).
        if (isPidAlive(meta.pid)) {
          process.kill(meta.pid, "SIGTERM");
        }
        console.error(`(socket error: ${(e as Error).message})`);
      }
      console.log(`stopped ${meta.id}`);
      process.exit(0);
    });
}
