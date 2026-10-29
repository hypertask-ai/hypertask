import prisma from "@/lib/prisma";
import { FEATURE_FLAG_OWNER_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7752_CHAT_ALERT_DIAGNOSTICS_FLAG } from "@/lib/flags/definitions/htpr-7752-chat-alert-diagnostics";
import { reportError } from "@/lib/errors/reportError";
import { deliverManagerAlert } from "./manager";
import { claimDelivery, evaluateAlerts, finishDelivery, type AlertSample } from "./store";
import type { AlertEnvironment } from "./policy";
import type { AiChatTurnOutcome } from "@/lib/telemetry/aiChatObservability";

async function reportAlertFailure(
  environment: AlertEnvironment,
  step: string,
  attemptCount = 0,
  failure?: { stage: string; error: unknown },
) {
  try {
    const extra: Record<string, string | number> = { environment, step, attemptCount };
    if (failure) {
      const candidate = failure.error && typeof failure.error === "object"
        ? failure.error as { name?: unknown; code?: unknown }
        : {};
      const allowedNames = [
        "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AggregateError", "AbortError",
        "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientValidationError",
        "PrismaClientInitializationError", "PrismaClientRustPanicError",
      ];
      extra.stage = failure.stage;
      extra.errorName = typeof candidate.name === "string" && allowedNames.includes(candidate.name)
        ? candidate.name : "UnknownError";
      if (typeof candidate.code === "string" && /^P\d{4}$/.test(candidate.code)) {
        extra.prismaCode = candidate.code;
      }
    }
    await reportError({
      source: "handled",
      message: `AI Chat Manager alert ${step} failed`,
      fingerprintKey: `ai-chat-alerts:${environment}:${step}`,
      extra,
    });
  } catch {
    console.warn("[ai/chat/alerts] handled error reporting failed");
  }
}

async function runAlertCycle(environment: AlertEnvironment, sample?: AlertSample) {
  try {
    await evaluateAlerts(prisma, environment, sample);
    const diagnostics = await isFeatureEnabled(HTPR_7752_CHAT_ALERT_DIAGNOSTICS_FLAG, FEATURE_FLAG_OWNER_USER_ID).catch(() => false);
    for (let index = 0; index < 8; index += 1) {
      const delivery = await claimDelivery(prisma, environment);
      if (!delivery) break;
      let stage = "delivery";
      try {
        await deliverManagerAlert(prisma, delivery, diagnostics ? (step) => { stage = step; } : undefined);
      } catch (error) {
        await reportAlertFailure(environment, "delivery", delivery.attemptCount, diagnostics ? { stage, error } : undefined);
        await finishDelivery(prisma, delivery, false);
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
  if (!Number.isFinite(turn.latencyMs) || turn.latencyMs < 0) return;
  await runAlertCycle(environment, {
    latencyMs: Math.min(2_147_483_647, Math.round(turn.latencyMs)),
    statusCode: turn.outcome === "failed" ? 500 : turn.outcome === "cancelled" ? 0 : 200,
  });
}

export async function sweepAiChatAlerts() {
  if (process.env.VERCEL_ENV !== "production") return;
  for (const environment of ["production", "preview"] as const) {
    await runAlertCycle(environment);
  }
}
