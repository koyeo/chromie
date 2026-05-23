import fs from "node:fs/promises";

import { BROWSERS_DIR, metaPath, socketPath, type BrowserMeta } from "./paths.js";

export async function ensureDir(): Promise<void> {
  await fs.mkdir(BROWSERS_DIR, { recursive: true });
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we lack permission to signal — still alive.
    return code === "EPERM";
  }
}

export async function writeMeta(meta: BrowserMeta): Promise<void> {
  await ensureDir();
  await fs.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

export async function readMeta(id: string): Promise<BrowserMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(id), "utf-8");
    return JSON.parse(raw) as BrowserMeta;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function listBrowsers(): Promise<BrowserMeta[]> {
  await ensureDir();
  const entries = await fs.readdir(BROWSERS_DIR);
  const metas: BrowserMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const meta = await readMeta(id);
    if (!meta) continue;
    if (!isPidAlive(meta.pid)) {
      // Stale — clean up.
      await cleanupFiles(id).catch(() => {});
      continue;
    }
    metas.push(meta);
  }
  return metas.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function resolveBrowser(input: string): Promise<BrowserMeta> {
  // Match by exact id first.
  const direct = await readMeta(input);
  if (direct && isPidAlive(direct.pid)) return direct;

  // Then by name.
  const all = await listBrowsers();
  const byName = all.filter((m) => m.name === input);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new Error(`Multiple browsers named "${input}"; use the full id instead.`);
  }

  // Then by id prefix (docker-style).
  const byPrefix = all.filter((m) => m.id.startsWith(input));
  if (byPrefix.length === 1) return byPrefix[0]!;
  if (byPrefix.length > 1) {
    throw new Error(`Ambiguous browser id prefix "${input}".`);
  }

  throw new Error(`No browser found for "${input}".`);
}

export async function cleanupFiles(id: string): Promise<void> {
  await Promise.all([
    fs.rm(metaPath(id), { force: true }),
    fs.rm(socketPath(id), { force: true }),
  ]);
}
