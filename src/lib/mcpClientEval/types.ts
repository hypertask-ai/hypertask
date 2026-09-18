export type McpClientEvalClient = "claude" | "cursor" | "codex";
export type McpClientEvalTransport = "mcp" | "cli";
export type McpClientEvalUsageSource =
  | "provider"
  | "transcript"
  | "estimate"
  | "unavailable";
export type McpClientEvalWallSource = "measured" | "transcript" | "unavailable";

export type McpClientEvalRow = {
  taskId: string;
  prompt: string;
  client: McpClientEvalClient;
  transport: McpClientEvalTransport;
  pass: boolean;
  reason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  usageSource: McpClientEvalUsageSource;
  wallMs: number | null;
  wallSource: McpClientEvalWallSource;
  toolCalls: number | null;
  mutating: boolean;
  mode: "replay" | "live";
  executor: string;
};

export type McpClientEvalSlice = {
  tasks: number;
  passed: number;
  failed: number;
  successRate: number;
  tokensIn: number | null;
  tokensOut: number | null;
  wallMs: number | null;
  toolCalls: number | null;
  live?: number;
  usageSource?: McpClientEvalUsageSource;
  wallSource?: McpClientEvalWallSource;
};

export type McpClientEvalSurface = {
  taskId: string;
  transport: McpClientEvalTransport;
  pass: boolean;
  reason: string | null;
  wallMs: number;
  wallSource: "measured";
  toolCalls: number | null;
  executor: string;
};

export type McpClientEvalReport = {
  generatedAt: string;
  label: string;
  baseline: string | null;
  mode: "replay" | "live" | "fixture";
  catalogVersion: number;
  rows: McpClientEvalRow[];
  surfaces?: McpClientEvalSurface[];
  summary: {
    tasks: number;
    passed: number;
    failed: number;
    successRate: number | null;
    surfaceFailed?: number;
    byTransport?: Record<
      McpClientEvalTransport,
      {
        tasks: number;
        passed: number;
        failed: number;
        successRate: number;
        wallMs: number;
        toolCalls: number | null;
      }
    >;
    byClient: Record<
      McpClientEvalClient,
      Record<McpClientEvalTransport, McpClientEvalSlice>
    >;
  };
};
