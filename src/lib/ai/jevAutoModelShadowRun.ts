import { generateText } from "ai";
import { waitUntil } from "@vercel/functions";

import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { gatewayProviderOptionsForModel, resolveGatewayModel, type AiGatewayTags } from "@/app/api/ai/_lib/modelProvider";
import { AUTO_LONG_THREAD_MESSAGES } from "@/app/api/ai/_lib/autoModel";
import { tierForFeature } from "@/app/api/ai/_lib/reasoningEffort";
import { HTPR_9048_JEV_AUTO_MODEL_SHADOW_FLAG } from "@/lib/flags/definitions/htpr-9048-jev-auto-model-shadow";
import prisma from "@/lib/prisma";
import {
  JEV_AUTO_MODEL_CALL_TIMEOUT_MS,
  JEV_AUTO_MODEL_SLUG,
  autoModelTurnSignals,
  buildJevAutoModelPrompt,
  compareAutoModelTiers,
  parseJevAutoModelGuess,
  tierForJevLevel,
} from "@/lib/ai/jevAutoModelShadow";

export type AutoModelShadowTurn = {
  userId: number;
  teamId: string | null;
  projectId: number | null;
  chatSessionId?: string | null;
  feature?: string | null;
  message: string;
  history?: ReadonlyArray<{ content?: string; role?: string }> | null;
  autoModelKey: string | null;
};

const askJev = async (prompt: string, apiKey: string, tags: AiGatewayTags) => {
  const model = resolveGatewayModel(JEV_AUTO_MODEL_SLUG, apiKey);
  const reply = generateText({
    model,
    prompt,
    maxOutputTokens: 24,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(JEV_AUTO_MODEL_CALL_TIMEOUT_MS),
    providerOptions: gatewayProviderOptionsForModel(model, "jev-auto-model", tags),
  }).then((result) => result.text, () => null);
  const deadline = new Promise<null>((resolve) => {
    const timer = setTimeout(() => resolve(null), JEV_AUTO_MODEL_CALL_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([reply, deadline]);
};

export async function shadowAutoModelTurn(turn: AutoModelShadowTurn): Promise<void> {
  if (!turn.teamId && turn.projectId === null) return;
  try {
    const funding = await getTeamGatewayFunding({
      trustedTeamId: turn.teamId,
      projectId: turn.projectId,
      userId: turn.userId,
    });
    if (!funding?.apiKey || funding.source === "customer") return;
    const signals = autoModelTurnSignals({
      message: turn.message,
      history: turn.history,
      longThreadMessages: AUTO_LONG_THREAD_MESSAGES,
    });
    const autoTier = Math.min(3, tierForFeature(turn.feature) + signals.stepUp);
    const started = Date.now();
    const text = await askJev(buildJevAutoModelPrompt(turn.message), funding.apiKey, {
      teamId: turn.teamId,
      projectId: turn.projectId,
      userId: turn.userId,
    });
    const guess = parseJevAutoModelGuess(text);
    const jevTier = guess ? tierForJevLevel(guess.level) : null;
    await prisma.autoModelShadow.create({
      data: {
        userId: turn.userId,
        teamId: turn.teamId,
        projectId: turn.projectId,
        chatSessionId: turn.chatSessionId ?? null,
        feature: turn.feature ?? "chat",
        autoTier,
        autoStepUp: signals.stepUp,
        autoModelKey: turn.autoModelKey,
        jevLevel: guess?.level ?? null,
        jevTier,
        jevConfidence: guess?.confidence ?? null,
        jevLatencyMs: Date.now() - started,
        longThread: signals.longThread,
        resent: signals.resent,
        codeFence: signals.codeFence,
        comparison: jevTier === null ? null : compareAutoModelTiers(jevTier, autoTier),
        error: guess ? null : String(text ?? "no answer").slice(0, 200),
      },
    });
  } catch (error) {
    console.warn("[ai/auto] jev shadow skipped", error);
  }
}

export async function shadowAutoModelTurnInBackground(turn: AutoModelShadowTurn): Promise<void> {
  try {
    const { isFeatureEnabled } = await import("@/lib/flags");
    if (!(await isFeatureEnabled(HTPR_9048_JEV_AUTO_MODEL_SHADOW_FLAG, turn.userId))) return;
  } catch {
    return;
  }
  const task = shadowAutoModelTurn(turn);
  try {
    waitUntil(task);
  } catch {
    void task.catch(() => undefined);
  }
}
