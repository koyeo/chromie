import os from "node:os";
import path from "node:path";

export const BROWSERS_DIR = path.join(os.homedir(), ".chromie", "browsers");

export function socketPath(id: string): string {
  return path.join(BROWSERS_DIR, `${id}.sock`);
}

export function metaPath(id: string): string {
  return path.join(BROWSERS_DIR, `${id}.json`);
}

export interface BrowserMeta {
  id: string;
  name: string | null;
  pid: number;
  socket: string;
  createdAt: string;
  pageIdRouting: boolean;
  version: string;
}
