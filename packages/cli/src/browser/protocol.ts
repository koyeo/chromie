// Wire protocol between `chromie` CLI and the `chromie browser` daemon.
//
// Transport: Unix-domain stream socket, one connection = one request/response.
// Framing:   single line of JSON terminated by '\n'.

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export type DaemonRequest =
  | { op: "ping" }
  | { op: "list" }
  | { op: "tool"; name: string; args: Record<string, unknown> }
  | { op: "shutdown" };

export type DaemonResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type ToolListData = { tools: Tool[] };
export type ToolCallData = CallToolResult;
export type PingData = { pid: number; version: string };

export function encodeMessage(msg: unknown): string {
  return JSON.stringify(msg) + "\n";
}
