import { PostHog } from "posthog-node";

import { redactErrorText } from "@/lib/telemetry/errorSanitization";

export type AiChatTurnOutcome = "ok" | "failed" | "cancelled";

const AI_CHAT_TURN_ERROR_LIMIT = 1000;
const CAPTURE_TIMEOUT_MS = 1500;

let client: PostHog | undefined;

function deploymentEnvironment() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
}

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
  event?: "$ai_generation" | "ai_chat_turn";
  userId: number | null;
  feature?: string;
  costUsd?: number | null;
  promptId?: string;
  promptVersion?: string;
  projectId?: number | null;
  teamId?: string | null;
  teamAllowanceUsd?: number | null;
  teamAllowanceUsedUsd?: number | null;
  taskId?: number | null;
  agentId?: string | null;
  model: string;
  provider: string;
  traceId: string;
  outcome: AiChatTurnOutcome;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: unknown;
};

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
    ht_feature: turn.feature ?? "chat",
    $ai_total_cost_usd: turn.costUsd ?? undefined,
    ht_prompt_id: turn.promptId ?? null,
    ht_prompt_version: turn.promptVersion ?? null,
    ht_user_id: turn.userId,
    ht_project_id: turn.projectId ?? null,
    ht_team_id: turn.teamId ?? null,
    ht_team_ai_allowance_usd: turn.teamAllowanceUsd ?? null,
    ht_team_ai_used_usd: turn.teamAllowanceUsedUsd ?? null,
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
    httpStatus = 0;
  }
  properties.$ai_http_status = httpStatus;
  return { distinctId: turn.userId == null ? "ai-system" : String(turn.userId), event: turn.event ?? "$ai_generation", properties };
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

export async function recordAiChatTurn(turn: AiChatTurnRecord): Promise<void> {
  const environment = deploymentEnvironment();
  if (environment === "production" || environment === "preview") {
    await captureAiChatTurn(turn, environment);
  }
}

export type AiChipRecord = {
  userId: number;
  event: "shown" | "clicked" | "ignored" | "next_typed";
  surface: string;
  chipType: string;
  chips: string[];
  chipIndex?: number;
  chipText?: string;
  typedText?: string;
  typedLength?: number;
  projectId: number | null;
  taskId: number | null;
};

export function buildAiChipCapture(chip: AiChipRecord, environment: string) {
  return {
    distinctId: String(chip.userId),
    event: `ai_chat_chip_${chip.event}`,
    properties: {
      ht_surface: chip.surface,
      ht_chip_type: chip.chipType,
      ht_chips: chip.chips,
      ht_chip_index: chip.chipIndex ?? null,
      ht_chip_text: chip.chipText ?? null,
      ht_typed_text: chip.typedText ?? null,
      ht_typed_length: chip.typedLength ?? null,
      ht_project_id: chip.projectId,
      ht_task_id: chip.taskId,
      ht_user_id: chip.userId,
      ht_environment: environment,
    },
  };
}

export async function recordAiChipEvent(chip: AiChipRecord): Promise<void> {
  const environment = deploymentEnvironment();
  const capture = buildAiChipCapture(chip, environment);
  console.info("[ai/chip-event]", JSON.stringify({ event: capture.event, ...capture.properties }));
  if (environment !== "production" && environment !== "preview") return;
  try {
    await postHogClient()?.captureImmediate(capture);
  } catch (error) {
    console.warn("[ai/chip-event] capture failed", error);
  }
}
