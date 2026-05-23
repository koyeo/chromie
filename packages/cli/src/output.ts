import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type OutputFormat = "text" | "json";

export function renderToolResult(result: CallToolResult, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }
  const content = result.content ?? [];
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === "text") {
      parts.push((item as { text: string }).text);
    } else if (item.type === "image") {
      parts.push(`[image: ${(item as { mimeType?: string }).mimeType ?? "binary"}]`);
    } else if (item.type === "resource") {
      const res = (item as { resource: { uri: string } }).resource;
      parts.push(`[resource: ${res.uri}]`);
    }
  }
  return parts.join("\n");
}
