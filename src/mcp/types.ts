export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error" | "pending";
  ms: number;
  summary: string;
  result?: unknown;
}
