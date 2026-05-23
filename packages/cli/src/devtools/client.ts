import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createInProcessMcp } from "../mcp/in-process.js";

interface Cached {
  client: Client;
  close: () => Promise<void>;
}

let cached: Cached | null = null;

export async function getMcpClient(): Promise<Client> {
  if (!cached) {
    cached = await createInProcessMcp();
  }
  return cached.client;
}

export async function closeMcpClient(): Promise<void> {
  if (cached) {
    const c = cached;
    cached = null;
    await c.close();
  }
}
