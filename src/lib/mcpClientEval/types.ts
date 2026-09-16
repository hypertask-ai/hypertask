export type McpClientEvalClient = "claude" | "cursor" | "codex";
export type McpClientEvalTransport = "mcp" | "cli";

export type McpClientEvalRow = {
  taskId: string;
  prompt: string;
  client: McpClientEvalClient;
  transport: McpClientEvalTransport;
  pass: boolean;
  reason: string | null;
  tokensIn: number;
  tokensOut: number;
  wallMs: number;
  toolCalls: number;
  mutating: boolean;
  mode: "replay" | "live";
};

export type McpClientEvalSlice = {
  tasks: number;
  passed: number;
  failed: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  wallMs: number;
  toolCalls: number;
};

export type McpClientEvalReport = {
  generatedAt: string;
  label: string;
  baseline: string | null;
  mode: "replay" | "live";
  catalogVersion: number;
  rows: McpClientEvalRow[];
  summary: {
    tasks: number;
    passed: number;
    failed: number;
    successRate: number;
    byClient: Record<
      McpClientEvalClient,
      Record<McpClientEvalTransport, McpClientEvalSlice>
    >;
  };
};
