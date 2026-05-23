import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
// Deep imports: chrome-devtools-mcp does not declare an `exports` map, but
// publishes its full build/src tree, so these paths are stable for a given
// minor version (we pin ~1.0.x in package.json).
import { createMcpServer } from "chrome-devtools-mcp";
import { parseArguments } from "chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp-cli-options.js";

interface Cached {
  client: Client;
  close: () => Promise<void>;
}

let cached: Cached | null = null;

const DEFAULT_ARGV = [
  "node",
  "chromie",
  "--headless",
  "--isolated",
  "--experimentalStructuredContent",
  "--categoryExtensions",
  "--no-usage-statistics",
];

async function build(): Promise<Cached> {
  // Suppress upstream usage stats unconditionally.
  process.env["CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS"] = "true";

  const serverArgs = parseArguments("0.0.0", DEFAULT_ARGV, process.env);
  const { server } = await createMcpServer(serverArgs, {});

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.server.connect(serverTransport);

  const client = new Client(
    { name: "chromie-cli", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.server.close();
    },
  };
}

export async function getMcpClient(): Promise<Client> {
  if (!cached) {
    cached = await build();
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
