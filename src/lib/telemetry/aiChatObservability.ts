/**
 * HTPR-6320: PostHog AI observability for the in-app AI Chat.
 *
 * Every generation is sent to PostHog as an `$ai_generation` event with the
 * user, model, token counts, latency and any error. No prompt or reply text is
 * ever sent.
 *
 * The event is emitted directly with the installed posthog-node client rather
 * than through `@posthog/ai`: that package's Vercel model wrapper only supports
 * AI SDK v5/v6 models and this app runs v7, and installing it pulls a
 * postinstall that downloads a binary, which fails the repo's network-isolated
 * app-smoke job. The `$ai_*` property names below are the ones PostHog's LLM
 * observability reads.
 */
import { PostHog } from "posthog-node";

import { redactErrorText } from "@/lib/telemetry/errorSanitization";

export type AiChatTurnOutcome = "ok" | "failed" | "cancelled";

const AI_CHAT_TURN_ERROR_LIMIT = 1000;
const CAPTURE_TIMEOUT_MS = 1500;

let client: PostHog | undefined;

function deploymentEnvironment() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
}

// ponytail: this mirrors the error-tracking module's client instead of sharing
// it, because that file sits under the repo's 14-day no-delete guard and a
// second flushAt-1 client costs nothing. Fold them together once that guard
// has expired.
export function postHogIngestionHost() {
  return process.env.POSTHOG_SERVER_HOST || "https://eu.i.posthog.com";
}

function postHogClient() {
  const token = process.env.POSTHOG_SERVER_PROJECT_TOKEN?.trim();
  if (!token) return undefined;
  if (!client) {
    client = new PostHog(token, {
      host: postHogIngestionHost(),
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: CAPTURE_TIMEOUT_MS,
      disableGeoip: true,
    });
  }
  return client;
}

/**
 * The SDK serialises a provider error into `$ai_error` verbatim, and some
 * providers echo request content back in that message. The ticket allows error
 * text only through the app's existing redaction rules, so every capture goes
 * through this before it reaches PostHog.
 */
export function redactAiCaptureProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof properties.$ai_error !== "string") return properties;
  return {
    ...properties,
    $ai_error: redactErrorText(properties.$ai_error, AI_CHAT_TURN_ERROR_LIMIT),
  };
}

export type AiChatTurnRecord = {
  userId: number;
  projectId?: number | null;
  taskId?: number | null;
  agentId?: string | null;
  /** The resolved model id and provider, as billed and logged by logAiUsage. */
  model: string;
  provider: string;
  traceId: string;
  outcome: AiChatTurnOutcome;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Only ever sent as a redacted `$ai_error` line, never as chat content. */
  error?: unknown;
};

/**
 * Builds the `$ai_generation` event for one turn: the properties PostHog LLM
 * observability reads, plus the distinct id it attributes the turn to. No
 * input or output body is ever included.
 */
export function buildAiChatTurnCapture(
  turn: AiChatTurnRecord,
  environment: string,
) {
  let httpStatus = 200;
  const properties: Record<string, unknown> = {
    $ai_trace_id: turn.traceId,
    $ai_provider: turn.provider,
    $ai_model: turn.model,
    $ai_input_tokens: turn.inputTokens ?? 0,
    $ai_output_tokens: turn.outputTokens ?? 0,
    $ai_latency: turn.latencyMs / 1000,
    $ai_model_parameters: {},
    ht_feature: "chat",
    ht_user_id: turn.userId,
    ht_project_id: turn.projectId ?? null,
    ht_task_id: turn.taskId ?? null,
    ht_agent_id: turn.agentId ?? null,
    ht_outcome: turn.outcome,
    ht_environment: environment,
  };
  if (turn.outcome === "failed") {
    httpStatus = 500;
    properties.$ai_is_error = true;
    properties.$ai_error = stringifyAiError(turn.error);
  } else if (turn.outcome === "cancelled") {
    // A cancelled turn is neither a success nor a server failure.
    httpStatus = 0;
  }
  properties.$ai_http_status = httpStatus;
  return { distinctId: String(turn.userId), event: "$ai_generation", properties };
}

function stringifyAiError(error: unknown) {
  const trim = (stack: string) => stack.split("\n").slice(0, 20).join("\n");
  if (error instanceof Error) {
    return JSON.stringify({
      name: error.name,
      message: error.message,
      stack: trim(error.stack ?? ""),
    });
  }
  return JSON.stringify({ message: String(error) });
}

/** Sends one `$ai_generation` event to PostHog. Never throws. */
async function captureAiChatTurn(
  turn: AiChatTurnRecord,
  environment: string,
): Promise<void> {
  try {
    const client = postHogClient();
    if (!client) return;
    const capture = buildAiChatTurnCapture(turn, environment);
    await client.captureImmediate({
      ...capture,
      properties: redactAiCaptureProperties(capture.properties),
    });
  } catch (error) {
    console.warn("[ai/chat/observability] generation capture failed", error);
  }
}

/** Records one finished AI Chat turn without affecting the chat response. */
export async function recordAiChatTurn(turn: AiChatTurnRecord): Promise<void> {
  const environment = deploymentEnvironment();
  if (environment === "production" || environment === "preview") {
    await captureAiChatTurn(turn, environment);
  }
}
