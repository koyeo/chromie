import net from "node:net";

import { resolveBrowser } from "./manager.js";
import {
  encodeMessage,
  type DaemonRequest,
  type DaemonResponse,
  type PingData,
  type ToolCallData,
  type ToolListData,
} from "./protocol.js";

async function sendRequest<T>(socketFilePath: string, req: DaemonRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const sock = net.createConnection(socketFilePath);
    let buffer = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      fn();
    };

    sock.on("connect", () => {
      sock.write(encodeMessage(req));
    });

    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      const nl = buffer.indexOf("\n");
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      try {
        const res = JSON.parse(line) as DaemonResponse<T>;
        if (res.ok) settle(() => resolve(res.data));
        else settle(() => reject(new Error(res.error)));
      } catch (e) {
        settle(() => reject(new Error(`Bad daemon response: ${(e as Error).message}`)));
      }
    });

    sock.on("error", (e) => settle(() => reject(e)));
    sock.on("end", () =>
      settle(() => reject(new Error("Daemon closed connection without response"))),
    );
  });
}

export async function pingBrowser(socketFilePath: string): Promise<PingData> {
  return sendRequest<PingData>(socketFilePath, { op: "ping" });
}

export async function listToolsViaDaemon(socketFilePath: string): Promise<ToolListData> {
  return sendRequest<ToolListData>(socketFilePath, { op: "list" });
}

export async function callToolViaDaemon(
  socketFilePath: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallData> {
  return sendRequest<ToolCallData>(socketFilePath, { op: "tool", name, args });
}

export async function shutdownBrowser(socketFilePath: string): Promise<void> {
  await sendRequest<{ stopping: true }>(socketFilePath, { op: "shutdown" });
}

export async function resolveBrowserSocket(input: string): Promise<string> {
  const meta = await resolveBrowser(input);
  return meta.socket;
}
