/**
 * HTPR-6320: PostHog AI observability for the in-app AI Chat.
 *
 * Two halves, deliberately separate:
 *
 * 1. Every generation is sent to PostHog AI observability as an
 *    `$ai_generation` event, with the user, model, token counts, latency and
 *    any error. No prompt or reply text is ever sent.
 * 2. `recordAiChatTurn` writes one tiny tally per turn to Redis and, when the
 *    last 15 minutes breach the ticket's thresholds, posts a single comment on
 *    the Manager's report thread. The thresholds are evaluated from what the
 *    server itself recorded, never from PostHog, so a forged client-side event
 *    can never raise an alert.
 *
 * The event is emitted directly with the installed posthog-node client rather
 * than through `@posthog/ai`: that package's Vercel model wrapper only supports
 * AI SDK v5/v6 models and this app runs v7, and installing it pulls a
 * postinstall that downloads a binary, which fails the repo's network-isolated
 * app-smoke job. The `$ai_*` property names below are the ones PostHog's LLM
 * observability reads.
 */
import { randomUUID } from "node:crypto";
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
/** Delivered claims refresh while breaching; pending delivery retries after this. */
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

/**
 * Sends one `$ai_generation` event to PostHog. Never throws.
 */
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

function windowKey() {
  return `ai:chat-turns:${deploymentEnvironment()}`;
}

function alertKey() {
  return `ai:chat-turn-alert:${deploymentEnvironment()}`;
}

function deliveredAlertKey() {
  return `ai:chat-turn-alert-delivered:${deploymentEnvironment()}`;
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

/**
 * Recovery rechecks the window inside the same Redis operation that deletes
 * the claim. A delayed turn can enter the window after the caller's snapshot;
 * if it breaches, its active incident claim must survive.
 */
const RECOVER_CLAIM_SCRIPT = `
local members = redis.call('ZRANGEBYSCORE', KEYS[2], ARGV[1], ARGV[2])
local latencies = {}
local total = 0
local failed = 0
for _, member in ipairs(members) do
  local latency, outcome = string.match(member, '^[^|]+|([^|]+)|([^|]+)$')
  if outcome and outcome ~= 'cancelled' then
    total = total + 1
    if outcome == 'failed' then failed = failed + 1 end
    local latency_number = tonumber(latency)
    if latency_number then table.insert(latencies, latency_number) end
  end
end
if total > 0 then
  table.sort(latencies)
  local p95 = 0
  if #latencies > 0 then
    p95 = latencies[math.ceil(#latencies * 0.95)] or 0
  end
  if failed / total > tonumber(ARGV[3]) or p95 > tonumber(ARGV[4]) then
    return 0
  end
end
local claimed = redis.call('GET', KEYS[1])
if claimed and tonumber(claimed) < tonumber(ARGV[2]) then
  return redis.call('DEL', KEYS[1], KEYS[3])
end
return 0
`;

function llmObservabilityUrl() {
  const projectId = process.env.POSTHOG_SERVER_PROJECT_ID?.trim();
  if (!projectId || !/^\d{1,12}$/.test(projectId)) return null;
  const uiHost = process.env.POSTHOG_UI_HOST?.trim() || "https://eu.posthog.com";
  return `${uiHost.replace(/\/$/, "")}/project/${projectId}/llm-observability`;
}

function alertCommentText(
  metrics: AiChatTurnWindowMetrics,
  incidentId: string,
) {
  const failedPercent = Math.round(metrics.errorRate * 100);
  const p95Seconds = (metrics.p95LatencyMs / 1000).toFixed(1);
  const problems: string[] = [];
  if (metrics.errorRate > AI_CHAT_TURN_ERROR_RATE_THRESHOLD) {
    problems.push(
      `${metrics.failed} of ${metrics.total} turns failed in the last 15 minutes (${failedPercent}%).`,
    );
  }
  if (metrics.p95LatencyMs > AI_CHAT_TURN_P95_LATENCY_THRESHOLD_MS) {
    problems.push(`The slowest 5% took ${p95Seconds}s.`);
  }
  const detailUrl = llmObservabilityUrl();
  return (
    `<p><strong>AI Chat is unhealthy: ${problems.join(" ")}</strong></p>` +
    (detailUrl
      ? `<p>Per-user and per-model detail: <a href="${detailUrl}">${detailUrl}</a></p>`
      : "") +
    `<p>Filed automatically by the AI Chat health watch. This stays quiet until the ` +
    `window recovers, so one comment means one ongoing problem.</p>` +
    `<p>Incident: <code>${incidentId}</code></p>`
  );
}

/**
 * Identifies the first caller, which alone posts the incident comment. Only a
 * delivered incident refreshes on later breaches; an undelivered claim expires
 * after the bounded cooldown so repaired configuration is eventually retried.
 */
const CLAIM_ALERT_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then
  redis.call('DEL', KEYS[2])
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  local claimed_at = tonumber(ARGV[1])
  if tonumber(existing) and tonumber(existing) > claimed_at then
    claimed_at = tonumber(existing)
  end
  redis.call('SET', KEYS[1], tostring(claimed_at), 'EX', ARGV[2])
  redis.call('SET', KEYS[2], tostring(claimed_at), 'EX', ARGV[2])
end
return 0
`;

const MARK_ALERT_DELIVERED_SCRIPT = `
local claimed = redis.call('GET', KEYS[1])
if not claimed or tonumber(claimed) == tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0
`;

/**
 * Posts at most one comment per ongoing problem: the claim key is held (and
 * refreshed) for as long as the window keeps breaching, and deleted the moment
 * it recovers.
 */
async function raiseAiChatTurnAlert(
  redis: Redis,
  metrics: AiChatTurnWindowMetrics,
  now: number,
) {
  const claimed = await redis.eval(
    CLAIM_ALERT_SCRIPT,
    2,
    alertKey(),
    deliveredAlertKey(),
    String(now),
    AI_CHAT_TURN_ALERT_TTL_SECONDS,
  );
  if (Number(claimed) !== 1) return false;
  const incidentId = randomUUID();
  const markDelivered = () =>
    redis.eval(
      MARK_ALERT_DELIVERED_SCRIPT,
      2,
      alertKey(),
      deliveredAlertKey(),
      String(now),
      AI_CHAT_TURN_ALERT_TTL_SECONDS,
    );
  let deliveryStarted = false;
  let taskId: number | undefined;
  try {
    const task = await prisma.task.findFirst({
      where: {
        projectId: FEATURE_FLAG_TICKET_PROJECT_ID,
        uniqueIndex: AI_CHAT_ALERT_TICKET_UNIQUE_INDEX,
      },
      select: { id: true, userId: true },
    });
    // A missing destination is configuration, not a transient delivery failure.
    // Keep the claim until its TTL instead of querying the database on every turn.
    if (!task) {
      console.error("[ai/chat/observability] alert ticket not found");
      return false;
    }
    taskId = task.id;
    const author = await prisma.user.findUnique({
      where: { id: FEATURE_FLAG_OWNER_USER_ID },
      select: { displayName: true },
    });
    const { createCommentService } = await import(
      "@/utils/controllers/comments/createCommentService"
    );
    deliveryStarted = true;
    await createCommentService({
      text: alertCommentText(metrics, incidentId),
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
    await markDelivered();
    return true;
  } catch (error) {
    console.error("[ai/chat/observability] alert delivery failed", error);
    if (deliveryStarted && taskId) {
      try {
        const committed = await prisma.comment.findFirst({
          where: {
            taskId,
            creatorId: FEATURE_FLAG_OWNER_USER_ID,
            text: { contains: `<code>${incidentId}</code>` },
          },
          select: { id: true },
        });
        if (committed) {
          await markDelivered();
          return true;
        }
      } catch (reconciliationError) {
        // Unknown commit state must keep the claim: retrying could post twice.
        console.error(
          "[ai/chat/observability] alert reconciliation failed",
          reconciliationError,
        );
        return false;
      }
    }
    // No matching row committed, so let the next breach retry delivery.
    await redis.del(alertKey()).catch(() => undefined);
    return false;
  }
}

/**
 * Records one finished AI Chat turn: one `$ai_generation` event in PostHog AI
 * observability, plus one tally in the 15-minute Redis window that drives the
 * health alert. Swallows its own failures; the stream schedules this work in
 * the background so capture latency never delays the chat turn.
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
      await redis.eval(
        RECOVER_CLAIM_SCRIPT,
        3,
        alertKey(),
        key,
        deliveredAlertKey(),
        String(now - AI_CHAT_TURN_WINDOW_MS),
        String(now),
        String(AI_CHAT_TURN_ERROR_RATE_THRESHOLD),
        String(AI_CHAT_TURN_P95_LATENCY_THRESHOLD_MS),
      );
      return metrics;
    }
    await raiseAiChatTurnAlert(redis, metrics, now);
    return metrics;
  } catch (error) {
    console.error("[ai/chat/observability] turn recording failed", error);
    return null;
  }
}
