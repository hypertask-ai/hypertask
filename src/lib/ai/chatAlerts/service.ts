import prisma from "@/lib/prisma";
import { FEATURE_FLAG_OWNER_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_6354_AI_CHAT_ALERTS_FLAG } from "@/lib/flags/keys";
import { reportError } from "@/lib/errors/reportError";
import { deliverManagerAlert } from "./manager";
import { claimDelivery, evaluateAlerts, finishDelivery, type AlertSample } from "./store";
import type { AlertEnvironment } from "./policy";
import type { AiChatTurnOutcome } from "@/lib/telemetry/aiChatObservability";

async function reportAlertFailure(environment: AlertEnvironment, step: string, attemptCount = 0) {
  try {
    await reportError({
      source: "handled",
      message: `AI Chat Manager alert ${step} failed`,
      fingerprintKey: `ai-chat-alerts:${environment}:${step}`,
      extra: { environment, step, attemptCount },
    });
  } catch {
    console.warn("[ai/chat/alerts] handled error reporting failed");
  }
}

async function runAlertCycle(environment: AlertEnvironment, sample?: AlertSample) {
  try {
    await evaluateAlerts(prisma, environment, sample);
    // Bound work per invocation even when many past incidents are retryable.
    for (let index = 0; index < 8; index += 1) {
      const delivery = await claimDelivery(prisma, environment);
      if (!delivery) break;
      try {
        await deliverManagerAlert(prisma, delivery);
      } catch {
        await finishDelivery(prisma, delivery, false);
        await reportAlertFailure(environment, "delivery", delivery.attemptCount);
        continue;
      }
      await finishDelivery(prisma, delivery, true);
    }
  } catch {
    await reportAlertFailure(environment, "processing");
  }
}

export async function recordAiChatAlertSample(turn: {
  userId: number;
  outcome: AiChatTurnOutcome;
  latencyMs: number;
}) {
  const environment = process.env.VERCEL_ENV;
  if (environment !== "production" && environment !== "preview") return;
  try {
    if (!(await isFeatureEnabled(HTPR_6354_AI_CHAT_ALERTS_FLAG, turn.userId))) return;
    if (!Number.isFinite(turn.latencyMs) || turn.latencyMs < 0) return;
    await runAlertCycle(environment, {
      latencyMs: Math.min(2_147_483_647, Math.round(turn.latencyMs)),
      statusCode: turn.outcome === "failed" ? 500 : turn.outcome === "cancelled" ? 0 : 200,
    });
  } catch {
    await reportAlertFailure(environment, "flag-check");
  }
}

export async function sweepAiChatAlerts() {
  if (process.env.VERCEL_ENV !== "production") return;
  try {
    if (!(await isFeatureEnabled(HTPR_6354_AI_CHAT_ALERTS_FLAG, FEATURE_FLAG_OWNER_USER_ID))) return;
    // Preview deployments share this DB but do not receive scheduled cron ticks.
    for (const environment of ["production", "preview"] as const) {
      await runAlertCycle(environment);
    }
  } catch {
    await reportAlertFailure("production", "flag-check");
  }
}
