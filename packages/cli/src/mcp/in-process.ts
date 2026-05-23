import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "chrome-devtools-mcp";
import { parseArguments } from "chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp-cli-options.js";

export interface InProcessMcpOptions {
  pageIdRouting?: boolean;
}

export interface InProcessMcp {
  client: Client;
  close: () => Promise<void>;
}

export async function createInProcessMcp(
  opts: InProcessMcpOptions = {},
): Promise<InProcessMcp> {
  process.env["CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS"] = "true";

  const argv = [
    "node",
    "chromie",
    "--headless",
    "--isolated",
    "--experimentalStructuredContent",
    "--categoryExtensions",
    "--no-usage-statistics",
  ];
  if (opts.pageIdRouting) {
    argv.push("--experimentalPageIdRouting");
  }

  const serverArgs = parseArguments("0.0.0", argv, process.env);
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
