import { ProviderId } from "@/lib/ai/chatStream/types";

export const PROJECT_ADMIN_MEMBER_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export const DEFAULT_PROVIDER: ProviderId = "openai";

export const DEFAULT_MODEL = "gpt-6-luna";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5.5";

export const MAX_TOOL_STEPS = 32;

export const MAX_BULK_TOOL_TARGETS = 50;

export const CLAUDE_MODELS = new Set([
  "claude-sonnet-5.5",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-opus-5.5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-haiku-5.5",
  "claude-haiku-5-5",
]);

export const OPENAI_MODELS = new Set([
  "gpt-6-luna",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-5.6-sol",
]);

export const TOOL_TASK_ID_DESCRIPTION =
  "internal database id -- do NOT derive it from the ticket number; pass ticket_number instead if you only know e.g. ABC-123";

export const bulkTaskTargetCount = (input: {
  task_ids?: number[];
  ticket_numbers?: string[];
}) => (input.task_ids?.length ?? 0) + (input.ticket_numbers?.length ?? 0);

export const bulkUserTargetCount = (input: {
  user_ids?: number[];
  users?: (number | string)[];
}) => (input.user_ids?.length ?? 0) + (input.users?.length ?? 0);
