/**
 * HTPR-6320: PostHog AI observability for the in-app AI Chat.
 *
 * Two halves, deliberately separate:
 *
 * 1. every generation is sent to PostHog AI observability through the official
 *    `captureAiGeneration` primitive, with the user, model, token counts,
 *    latency and any error, in privacy mode so no prompt or reply text is
 *    ever sent.
 * 2. `recordAiChatTurn` writes one tiny tally per turn to Redis and, when the
 *    last 15 minutes breach the ticket's thresholds, posts a single comment on
 *    the Manager's report thread. The thresholds are evaluated from what the
 *    server itself recorded, never from PostHog, so a forged client-side event
 *    can never raise an alert.
 */
import { randomUUID } from "node:crypto";
import { captureAiGeneration } from "@posthog/ai";
import type { Redis } from "ioredis";
import { PostHog } from "posthog-node";

import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { redactErrorText } from "@/lib/telemetry/errorSanitization";
import {
  FEATURE_FLAG_OWNER_USER_ID,
  FEATURE_FLAG_TICKET_PROJECT_ID,
} from "@/lib/flags";

export type AiChatTurnOutcome = "ok" | "failed" | "cancelled";

export type AiChatTurnWindowMetrics = {
  total: number;
  failed: number;
  errorRate: number;
  p95LatencyMs: number;
};

/** The ticket's alerting window: "error rate over 5% in 15 min". */
export const AI_CHAT_TURN_WINDOW_MS = 15 * 60 * 1000;
const AI_CHAT_TURN_ERROR_RATE_THRESHOLD = 0.05;
const AI_CHAT_TURN_P95_LATENCY_THRESHOLD_MS = 20_000;
/** Held as long as the window keeps breaching, so one incident = one comment. */
const AI_CHAT_TURN_ALERT_TTL_SECONDS = 15 * 60;
const AI_CHAT_TURN_ERROR_LIMIT = 1000;
const CAPTURE_TIMEOUT_MS = 1500;
/** HTPR-6225, the HT Manager's report thread. */
const AI_CHAT_ALERT_TICKET_UNIQUE_INDEX = 6225;

let client: PostHog | undefined;

function deploymentEnvironment() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
}

// ponytail: this mirrors the error-tracking module's client instead of sharing
// it, because that file sits under the repo's 14-day no-delete guard and a
// second flushAt-1 client costs nothing. Fold them together once that guard
// has expired.
function postHogClient() {
  const token = process.env.POSTHOG_SERVER_PROJECT_TOKEN?.trim();
  if (!token) return undefined;
  if (!client) {
    client = new PostHog(token, {
      host: process.env.POSTHOG_SERVER_HOST || "https://eu.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: CAPTURE_TIMEOUT_MS,
      disableGeoip: true,
    });
  }
  return client;
}

type AiCaptureEvent = {
  distinctId?: string;
  event: string;
  properties?: Record<string, unknown>;
};

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

function redactingClient(client: PostHog): PostHog {
  const forward = (event: AiCaptureEvent, immediate: boolean) => {
    const payload = {
      ...event,
      properties: redactAiCaptureProperties(event.properties ?? {}),
    };
    return immediate ? client.captureImmediate(payload) : client.capture(payload);
  };
  return {
    capture: (event: AiCaptureEvent) => forward(event, false),
    captureImmediate: (event: AiCaptureEvent) => forward(event, true),
  } as unknown as PostHog;
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
 * Builds the `$ai_generation` payload for one turn. Privacy mode is always on
 * and both bodies are null, so no prompt or reply text can reach PostHog even
 * if the client is later reconfigured.
 */
export function buildAiChatTurnCapture(
  turn: AiChatTurnRecord,
  environment: string,
) {
  return {
    distinctId: String(turn.userId),
    traceId: turn.traceId,
    provider: turn.provider,
    model: turn.model,
    input: null,
    output: null,
    privacyMode: true,
    // Serverless: the event has to be flushed before the function ends.
    captureImmediate: true,
    // A cancelled turn is not a server failure, so it carries no status.
    httpStatus:
      turn.outcome === "ok" ? 200 : turn.outcome === "failed" ? 500 : undefined,
    latency: turn.latencyMs / 1000,
    usage: {
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
    },
    ...(turn.outcome === "failed" && turn.error !== undefined
      ? { error: turn.error }
      : {}),
    properties: {
      ht_feature: "chat",
      ht_user_id: turn.userId,
      ht_project_id: turn.projectId ?? null,
      ht_task_id: turn.taskId ?? null,
      ht_agent_id: turn.agentId ?? null,
      ht_outcome: turn.outcome,
      ht_environment: environment,
    },
  };
}

/**
 * Sends one `$ai_generation` event through the official PostHog AI primitive.
 * Never throws.
 */
async function captureAiChatTurn(
  turn: AiChatTurnRecord,
  environment: string,
): Promise<void> {
  try {
    const client = postHogClient();
    if (!client) return;
    await captureAiGeneration(
      redactingClient(client),
      buildAiChatTurnCapture(turn, environment),
    );
  } catch (error) {
    console.warn("[ai/chat/observability] generation capture failed", error);
  }
}

function windowKey() {
  return `ai:chat-turns:${deploymentEnvironment()}`;
}

function alertKey() {
  return `ai:chat-turn-alert:${deploymentEnvironment()}`;
}

/**
 * Members are `${nonce}|${latencyMs}|${outcome}`. Cancelled turns are
 * recorded so a turn never vanishes from the count, but they are neither
 * failures nor slow, so both thresholds ignore them.
 */
export function evaluateAiChatTurnWindow(members: string[]): AiChatTurnWindowMetrics {
  const latencies: number[] = [];
  let failed = 0;
  let counted = 0;
  for (const member of members) {
    const [, latency, outcome] = member.split("|");
    if (outcome === "cancelled") continue;
    const latencyMs = Number(latency);
    if (Number.isFinite(latencyMs)) latencies.push(latencyMs);
    counted += 1;
    if (outcome === "failed") failed += 1;
  }
  latencies.sort((left, right) => left - right);
  const p95 =
    latencies.length === 0
      ? 0
      : latencies[Math.ceil(latencies.length * 0.95) - 1] ?? 0;
  return {
    total: counted,
    failed,
    errorRate: counted === 0 ? 0 : failed / counted,
    p95LatencyMs: p95,
  };
}

export function aiChatTurnWindowBreached(metrics: AiChatTurnWindowMetrics) {
  return (
    metrics.total > 0 &&
    (metrics.errorRate > AI_CHAT_TURN_ERROR_RATE_THRESHOLD ||
      metrics.p95LatencyMs > AI_CHAT_TURN_P95_LATENCY_THRESHOLD_MS)
  );
}

function llmObservabilityUrl() {
  const projectId = process.env.POSTHOG_SERVER_PROJECT_ID?.trim();
  if (!projectId || !/^\d{1,12}$/.test(projectId)) return null;
  const uiHost = process.env.POSTHOG_UI_HOST?.trim() || "https://eu.posthog.com";
  return `${uiHost.replace(/\/$/, "")}/project/${projectId}/llm-observability`;
}

function alertCommentText(metrics: AiChatTurnWindowMetrics) {
  const failedPercent = Math.round(metrics.errorRate * 100);
  const p95Seconds = (metrics.p95LatencyMs / 1000).toFixed(1);
  const detailUrl = llmObservabilityUrl();
  return (
    `<p><strong>AI Chat is unhealthy: ${metrics.failed} of ${metrics.total} turns ` +
    `failed in the last 15 minutes (${failedPercent}%).</strong> The slowest 5% took ` +
    `${p95Seconds}s.</p>` +
    (detailUrl
      ? `<p>Per-user and per-model detail: <a href="${detailUrl}">${detailUrl}</a></p>`
      : "") +
    `<p>Filed automatically by the AI Chat health watch. This stays quiet until the ` +
    `window recovers, so one comment means one ongoing problem.</p>`
  );
}

/**
 * Posts at most one comment per ongoing problem: the claim key is held (and
 * refreshed) for as long as the window keeps breaching, and deleted the moment
 * it recovers.
 */
async function raiseAiChatTurnAlert(
  redis: Redis,
  metrics: AiChatTurnWindowMetrics,
) {
  const claimed = await redis.set(
    alertKey(),
    new Date().toISOString(),
    "EX",
    AI_CHAT_TURN_ALERT_TTL_SECONDS,
    "NX",
  );
  if (claimed !== "OK") {
    await redis.expire(alertKey(), AI_CHAT_TURN_ALERT_TTL_SECONDS);
    return false;
  }
  try {
    const task = await prisma.task.findFirst({
      where: {
        projectId: FEATURE_FLAG_TICKET_PROJECT_ID,
        uniqueIndex: AI_CHAT_ALERT_TICKET_UNIQUE_INDEX,
      },
      select: { id: true, userId: true },
    });
    if (!task) throw new Error("AI Chat alert ticket not found");
    const author = await prisma.user.findUnique({
      where: { id: FEATURE_FLAG_OWNER_USER_ID },
      select: { displayName: true },
    });
    const { createCommentService } = await import(
      "@/utils/controllers/comments/createCommentService"
    );
    await createCommentService({
      text: alertCommentText(metrics),
      creatorId: FEATURE_FLAG_OWNER_USER_ID,
      taskId: task.id,
      ownerId: task.userId,
      currentUser: {
        id: FEATURE_FLAG_OWNER_USER_ID,
        displayName: author?.displayName ?? "Hypertask",
      },
      accessUserId: FEATURE_FLAG_OWNER_USER_ID,
      processTaskReferences: false,
    });
    return true;
  } catch (error) {
    // Let the next breach retry: without this the claim would silence the
    // rest of the incident.
    await redis.del(alertKey()).catch(() => undefined);
    console.error("[ai/chat/observability] alert comment failed", error);
    return false;
  }
}

/**
 * Records one finished AI Chat turn: one `$ai_generation` event in PostHog AI
 * observability, plus one tally in the 15-minute Redis window that drives the
 * health alert. Swallows its own failures: observability must never break or
 * delay a chat turn.
 */
export async function recordAiChatTurn(
  turn: AiChatTurnRecord,
  now: number = Date.now(),
): Promise<AiChatTurnWindowMetrics | null> {
  const environment = deploymentEnvironment();
  if (environment === "production" || environment === "preview") {
    await captureAiChatTurn(turn, environment);
  }
  try {
    const redis = await getRedis();
    const key = windowKey();
    await redis.zadd(
      key,
      now,
      `${randomUUID()}|${Math.round(turn.latencyMs)}|${turn.outcome}`,
    );
    await redis.zremrangebyscore(key, "-inf", now - AI_CHAT_TURN_WINDOW_MS);
    await redis.expire(key, AI_CHAT_TURN_WINDOW_MS / 1000);
    // Preview deployments share production's database, so only production
    // may speak on the board.
    if (environment !== "production") return null;
    const metrics = evaluateAiChatTurnWindow(
      await redis.zrangebyscore(key, now - AI_CHAT_TURN_WINDOW_MS, now),
    );
    if (!aiChatTurnWindowBreached(metrics)) {
      await redis.del(alertKey());
      return metrics;
    }
    await raiseAiChatTurnAlert(redis, metrics);
    return metrics;
  } catch (error) {
    console.error("[ai/chat/observability] turn recording failed", error);
    return null;
  }
}
