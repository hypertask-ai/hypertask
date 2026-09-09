import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import { getAiRequestUser } from "@/app/api/ai/_lib/requestUser";
import {
  FEATURE_FLAG_OWNER_USER_ID,
  HTPR_6320_AI_OBSERVABILITY_FLAG,
  isFeatureEnabled,
} from "@/lib/flags";
import {
  postHogIngestionHost,
  recordAiChatTurn,
} from "@/lib/telemetry/aiChatObservability";
import { redactErrorText } from "@/lib/telemetry/errorSanitization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROBE_MODEL = "gpt-5.4-mini";
// Deliberately invalid: the probe has to fail so the failure path (a redacted
// `$ai_error` in PostHog plus a tally in the alert window) is really exercised.
const PROBE_API_KEY = "htpr-6320-observability-probe";

/**
 * HTPR-6320: fires one real, deliberately failing AI generation through the
 * same observability path the AI Chat uses, and reports the resulting 15-minute
 * window. Owner-only and flag-gated: it writes a comment on the board when the
 * window breaches, so it is not a public endpoint.
 */
export async function POST(request: NextRequest) {
  const requestUser = await getAiRequestUser(request);
  if (!requestUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Not a flag check used as authorization: the flag only keeps the probe
  // dormant while the feature is off. Identity is the session above.
  if (
    requestUser.id !== FEATURE_FLAG_OWNER_USER_ID ||
    !(await isFeatureEnabled(HTPR_6320_AI_OBSERVABILITY_FLAG, requestUser.id))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const startedAt = Date.now();
  let outcome: "ok" | "failed" = "ok";
  let error: unknown;
  try {
    await generateText({
      model: createOpenAI({ apiKey: PROBE_API_KEY })(PROBE_MODEL),
      prompt: "Reply with the single word: ok",
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20_000),
    });
  } catch (probeError) {
    outcome = "failed";
    error = probeError;
  }

  const metrics = await recordAiChatTurn({
    userId: requestUser.id,
    model: PROBE_MODEL,
    provider: "openai",
    traceId: randomUUID(),
    outcome,
    latencyMs: Date.now() - startedAt,
    error,
  });

  return NextResponse.json({
    outcome,
    error: error ? redactErrorText(String(error), 500) : null,
    metrics,
    posthog: {
      host: postHogIngestionHost(),
      project_id: process.env.POSTHOG_SERVER_PROJECT_ID ?? null,
    },
  });
}
