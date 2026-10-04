import { toErrorMessage } from "@/lib/api/errorMessage";
import { z } from "zod";
import { reportError } from "@/lib/errors/reportError";
import { SseEvent } from "@/lib/ai/chatStream/types";
import { SSE_HEADERS } from "@/lib/ai/tools/constants";

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
  // Prisma/driver errors carry schema and query detail, so those stay internal.
  if (error instanceof Error && error.name.startsWith("Prisma")) {
    console.error("[ai/chat/stream] internal error", error);
    return "Sorry, an error occurred while processing your request.";
  }
  // Tool loops need the provider's real text. The SDK
  // sometimes hands us a plain object, not an Error; keep its cause available
  // to the model without persisting a provider's echoed request body.
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

/** The allowance stop unwrapped from the SDK's retry chain, or null. */
export function includedAllowanceError(error: unknown) {
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error) {
      if (current.name === "SharedAiAllowanceExceededError") {
        return current as Error & { periodKey?: string };
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

// Tool errors need verbatim detail for the model, but streamed errors are user-visible.
export function userFacingErrorMessage(error: unknown, stage: string) {
  console.error(`[ai/chat/stream] ${stage} user-facing error`, error);
  const allowanceError = includedAllowanceError(error);
  if (allowanceError) return allowanceError.message;
  return "Sorry, something went wrong while generating a response. Please try again.";
}

/**
 * Extra fields for a streamed error event. The allowance period travels with
 * the stop so a background caller can deduplicate against the period that
 * actually rejected, instead of re-deriving one from its own clock and keying
 * the wrong month at a rollover. The charged team travels with it so the
 * caller can attribute the stop to exactly the team whose allowance is spent.
 */
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
  console.error(`[ai/chat/stream] request-${stage} user-facing error`, error);
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
  // A missing value reads as "required"; anything else is "invalid".
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
      error.name === "AiGatewayKeyRequiredError")
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
