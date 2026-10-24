import { toErrorMessage } from "@/lib/api/errorMessage";
import { z } from "zod";
import { reportError } from "@/lib/errors/reportError";
import { SseEvent } from "@/lib/ai/chatStream/types";
import { SSE_HEADERS } from "@/lib/ai/tools/constants";
import { HTPR_7754_DEEPSEEK_AUTH_REFUSAL_FLAG } from "@/lib/flags/definitions/htpr-7754-deepseek-auth-refusal";

export function sseFrame(event: SseEvent, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSseErrorResponse(message: string, status?: number) {
  return new Response(
    sseFrame("error", { content: message }) +
    sseFrame("done", { status: "error" }),
    { ...(status ? { status } : {}), headers: SSE_HEADERS }
  );
}

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.name.startsWith("Prisma")) {
    console.error("[ai/chat/stream] internal error", error);
    return "Sorry, an error occurred while processing your request.";
  }
  return toErrorMessage(
    error,
    "Sorry, an error occurred while processing your request.",
  );
}

export function handledErrorExtra(error: unknown) {
  if (!error || typeof error !== "object") return {};
  const record = error as Record<string, unknown>;
  const extra: Record<string, string | number | boolean | null> = {};
  for (const key of ["statusCode", "status"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      extra[key] = value;
    }
  }
  return extra;
}

export function includedAllowanceError(error: unknown) {
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error) {
      if (current.name === "SharedAiAllowanceExceededError") {
        return current as Error & { periodKey?: string; reason?: "month" | "day" | "demo" };
      }
      const wrapped = current as Error & {
        cause?: unknown;
        lastError?: unknown;
      };
      current = wrapped.cause ?? wrapped.lastError;
      continue;
    }
    if (typeof current === "object") {
      const wrapped = current as { cause?: unknown; lastError?: unknown };
      current = wrapped.cause ?? wrapped.lastError;
      continue;
    }
    break;
  }
  return null;
}

export async function normalizeProviderAuthError(error: unknown, userId: number) {
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (typeof current !== "object") break;
    const record = current as {
      url?: unknown;
      statusCode?: unknown;
      cause?: unknown;
      lastError?: unknown;
    };
    if (
      record.url === "https://api.deepseek.com/chat/completions" &&
      record.statusCode === 401
    ) {
      const enabled = await import("@/lib/flags")
        .then(({ isFeatureEnabled }) => isFeatureEnabled(HTPR_7754_DEEPSEEK_AUTH_REFUSAL_FLAG, userId))
        .catch(() => false);
      if (!enabled) return error;
      const refusal = new Error("DeepSeek rejected your AI key. Update it in Settings > AI keys, then try again.");
      refusal.name = "AiProviderAuthenticationError";
      return refusal;
    }
    current = record.cause ?? record.lastError;
  }
  return error;
}

export function userFacingErrorMessage(error: unknown, stage: string) {
  const allowanceError = includedAllowanceError(error);
  if (allowanceError) {
    console.info(`[ai/chat/stream] ${stage} refused: included AI allowance used up`);
    return allowanceError.message;
  }
  if (error instanceof Error && error.name === "AiProviderAuthenticationError") {
    console.warn(`[ai/chat/stream] ${stage} refused: DeepSeek AI key rejected`);
    return error.message;
  }
  console.error(`[ai/chat/stream] ${stage} user-facing error`, error);
  return "Sorry, something went wrong while generating a response. Please try again.";
}

export function userFacingErrorDetails(error: unknown, teamId: string | null) {
  const periodKey = includedAllowanceError(error)?.periodKey;
  if (!periodKey) return {};
  return {
    allowancePeriod: periodKey,
    ...(teamId ? { allowanceTeamId: teamId } : {}),
  };
}

export function requestErrorMessage(
  error: unknown,
  stage: "body" | "validation",
) {
  if (stage === "body" && error instanceof SyntaxError) {
    console.info("[ai/chat/stream] request-body refused: invalid JSON");
  } else if (stage === "validation" && error instanceof z.ZodError) {
    console.info("[ai/chat/stream] request-validation refused: invalid request");
  } else {
    console.error(`[ai/chat/stream] request-${stage} user-facing error`, error);
  }
  if (stage === "body") {
    return "Invalid request: the request body could not be read.";
  }
  if (!(error instanceof z.ZodError) || error.issues.length === 0) {
    return "Invalid request.";
  }

  const fieldIssues = error.issues.flatMap((issue) => {
    const field = issue.path
      .filter((part): part is string => typeof part === "string")
      .map((part) =>
        part
          .replace(/_/g, " ")
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase(),
      )
      .join(" ");
    return field ? [{ field, code: issue.code }] : [];
  });
  const fields = [...new Set(fieldIssues.map(({ field }) => field))];
  if (fields.length === 0) return "Invalid request.";
  const fieldList =
    fields.length === 1
      ? fields[0]
      : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`;
  const fieldsAreRequired = fieldIssues.every(
    ({ code }) => code === "too_small" || code === "invalid_type",
  );
  return `Invalid request: ${fieldList} ${fields.length === 1 ? "is" : "are"} ${fieldsAreRequired ? "required" : "invalid"
    }.`;
}

export async function reportHandledChatError(
  error: unknown,
  stage: string,
  extra?: Record<string, string | number | boolean | null>,
) {
  if (includedAllowanceError(error)) return;
  if (
    error instanceof Error &&
    (error.name === "AiPlanAccessError" ||
      error.name === "AiGatewayKeyRequiredError" ||
      error.name === "AiProviderAuthenticationError")
  ) {
    return;
  }
  const normalized = new Error("AI chat request failed");
  const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(error.name)
    ? error.name : "ChatError";
  await reportError({
    message: normalized.message,
    stack: normalized.stack,
    url: "/api/ai/chat/stream",
    source: "handled",
    fingerprintKey: `ai-chat:${stage}:${errorName}`,
    extra: { stage, errorName, ...handledErrorExtra(error), ...extra },
  });
}

export const EMPTY_COMPLETION_TICKET_THRESHOLD = 50;

export async function reportEmptyCompletion(retryFailed: boolean, error: unknown) {
  if (retryFailed) {
    await reportHandledChatError(error, "empty-completion-retry");
    return;
  }

  const normalized = new Error("AI chat returned an empty completion");
  await reportError({
    message: normalized.message,
    stack: normalized.stack,
    url: "/api/ai/chat/stream",
    source: "handled",
    extra: { stage: "empty-completion" },
    minimumOccurrences: EMPTY_COMPLETION_TICKET_THRESHOLD,
    fingerprintKey: "ai-chat-empty-completion",
  });
}
