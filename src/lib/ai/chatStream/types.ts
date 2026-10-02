

export type ProviderId =
  | "claude"
  | "openai"
  | "openrouter"
  | "gateway"
  | "custom";

export type AuthedUser = { id: number; email: string; displayName?: string | null };

export type SseEvent = "status" | "content" | "title" | "done" | "error" | "agent";

export type ToolExecution = { name: string; result: unknown };

export type ToolExecutionRecorder = (execution: ToolExecution) => void;

export type ToolStartRelease = () => void | Promise<void>;

export type ToolStartRecorder = (
  name: string,
) => void | ToolStartRelease | Promise<void | ToolStartRelease>;
