import { includedAllowanceError, isOwnKeyAuthFailure } from "@/lib/ai/chatStream/errors";
import { redactErrorText } from "@/lib/telemetry/errorSanitization";
import type { AiChatTurnOutcome } from "@/lib/telemetry/aiChatObservability";

const ROUTE = "/api/ai/chat/stream";
const ERROR_TEXT_LIMIT = 300;

const BARE_SECRET_PATTERNS = [
  /\b(?:sk|rk|pk|ak)[-_][A-Za-z0-9_-]{8,}/g,
  /\bAIza[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b[A-Za-z0-9_+/=-]{32,}/g,
];

function withoutBareSecrets(text: string) {
  return BARE_SECRET_PATTERNS.reduce(
    (value, pattern) => value.replace(pattern, "[redacted]"),
    text,
  );
}

export type AiChatRequestLogInput = {
  requestId: string;
  userId: number;
  projectId?: number | null;
  taskId?: number | null;
  agentId?: string | null;
  model: string;
  provider: string;
  outcome: AiChatTurnOutcome;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: unknown;
};

export type AiChatFailureStory = {
  name: string;
  message: string;
  why: string;
  fix: string;
};

function errorName(error: unknown) {
  if (error && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return error === undefined || error === null ? "NoError" : "Error";
}

export function aiChatFailureStory(
  error: unknown,
  provider?: string | null,
): AiChatFailureStory {
  const name = errorName(error);
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "The AI chat turn failed without a message.";
  const message = redactErrorText(
    withoutBareSecrets(raw.trim() || "The AI chat turn failed."),
    ERROR_TEXT_LIMIT,
  );

  if (includedAllowanceError(error)) {
    return {
      name,
      message,
      why: "The team used up its included AI allowance for this period.",
      fix: "Raise the team AI allowance in Settings, AI usage, or wait for the next period.",
    };
  }
  if (isOwnKeyAuthFailure(provider, error) || name === "AiProviderAuthenticationError") {
    return {
      name,
      message,
      why: "The AI provider rejected the key used for this turn.",
      fix: "Update the key in Settings, AI, bring your own key, then ask again.",
    };
  }
  if (name === "ForcedTeamKeyError") {
    return {
      name,
      message,
      why: "A team rule forced a shared key and the provider refused the call.",
      fix: "Check the team AI key in Settings, AI, then ask again.",
    };
  }
  if (/deadline|timed out|timeout/i.test(message)) {
    return {
      name,
      message,
      why: "The turn ran past the time limit for one reply.",
      fix: "Ask a smaller question or split it into two turns.",
    };
  }
  if (name.startsWith("Prisma")) {
    return {
      name,
      message,
      why: "A database call inside the turn failed.",
      fix: "Ask again. If it repeats, check database health for this deployment.",
    };
  }
  return {
    name,
    message,
    why: "The turn stopped with the message above.",
    fix: "Ask again; the failing step is in this line's error name.",
  };
}

export function buildAiChatRequestEvent(input: AiChatRequestLogInput) {
  const event: Record<string, unknown> = {
    method: "POST",
    path: ROUTE,
    requestId: input.requestId,
    outcome: input.outcome,
    durationMs: input.durationMs,
    user: { id: input.userId },
    ai: {
      model: input.model,
      provider: input.provider,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
    },
  };
  if (typeof input.projectId === "number") event.project = { id: input.projectId };
  if (typeof input.taskId === "number") event.ticket = { id: input.taskId };
  if (input.agentId) event.agent = { id: input.agentId };
  if (input.outcome === "failed") {
    event.error = aiChatFailureStory(input.error, input.provider);
  }
  return event;
}
