import { isHaiku55Model } from "../../../../../lib/aiModelOptions";

const PREVIOUS_MODELS: Record<string, string> = {
  "gpt-6-luna": "gpt-5.6-luna",
  "gpt-6.1-sol": "gpt-6-sol",
  "claude-sonnet-5.5": "claude-sonnet-5",
  "claude-sonnet-5-5": "claude-sonnet-5",
  "claude-opus-5.5": "claude-opus-5",
  "claude-opus-5-5": "claude-opus-5",
};

export function previousModelForFailedStream(
  model: string,
  error: unknown,
  hasStreamedContent: boolean,
  hasExecutedTools: boolean,
  haiku55Enabled = false,
): { model: string; status: string } | null {
  const previous = haiku55Enabled && isHaiku55Model(model)
    ? "gpt-6-luna"
    : PREVIOUS_MODELS[model];
  if (!previous || hasStreamedContent || hasExecutedTools) return null;
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current !== "object") break;
    const detail = current as {
      status?: unknown;
      statusCode?: unknown;
      message?: unknown;
      cause?: unknown;
      lastError?: unknown;
      name?: unknown;
    };
    const status = detail.statusCode ?? detail.status;
    if (status === 404 || status === 403) {
      return { model: previous, status: String(status) };
    }
    if (
      typeof detail.message === "string" &&
      /model.{0,50}(not found|not available|unavailable|does not exist|unknown)/i.test(detail.message)
    ) {
      return { model: previous, status: "model not available" };
    }
    current = detail.name === "RetryError" && detail.lastError
      ? detail.lastError
      : detail.cause ?? detail.lastError;
  }
  return null;
}
