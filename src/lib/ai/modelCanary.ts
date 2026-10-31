import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import { selectModel } from "@/lib/ai/chatStream/models";
import { aiImageModelDefinitions, aiModelOptions, getAiModelDefinition, isAiModelOptionVisible, type TAiModelOption } from "@/lib/aiModelOptions";
import { getAiProviderInfo, resolveTeamProviderEnabled, type TByokProviderKey } from "@/lib/aiProviders";
import { resolveTeamByokApiKey } from "@/app/api/ai/_lib/byokKeys";
import { isPlatformAiCredential, resolveTeamAiFunding } from "@/lib/ai/teamAiFunding";
import { gatewayCatalogModelSlug } from "@/app/api/ai/_lib/sharedAllowance";
import { configureAiModelUsage, isVercelAiGatewayKey } from "@/app/api/ai/_lib/modelProvider";
import { FEATURE_FLAG_QA_USER_ID } from "@/lib/auth/ownerOrQaIds";
import { redactSecrets } from "@/lib/errors/errorFingerprint";
import { redactErrorText } from "@/lib/telemetry/errorSanitization";
import { reportError } from "@/lib/errors/reportError";
import { downloadWithoutBrotli } from "@/lib/net/downloadWithoutBrotli";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

const ROOT = "ai-model-canary:v1";
const LATEST = `${ROOT}:latest`;
const LOCK = `${ROOT}:lock`;
const STATE = `${ROOT}:state`;
const PROBE_MS = 45_000;
const BUDGET_MS = 230_000;
const RELEASE = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`;
const SAVE = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("HSET", KEYS[2], ARGV[2], ARGV[3])
return 1
`;

type Outcome = "pass" | "fail" | "skipped" | "inconclusive";
type Stage = "pricing" | "gateway" | "provider" | "empty";
export type ModelCanaryRow = {
  optionId: string;
  label: string;
  model: string;
  lane: string;
  capability: "chat" | "image";
  outcome: Outcome;
  stage: Stage | null;
  statusCode: number | null;
  safeError: string | null;
  latencyMs: number;
  checkedAt: string;
  lastPassAt: string | null;
  dailyFailDates: string[];
};

type Target = Pick<ModelCanaryRow, "optionId" | "label" | "model" | "capability"> & {
  option?: TAiModelOption;
  provider?: TByokProviderKey;
};
export type ModelCanaryCounts = Record<"checked" | Outcome, number>;

function modelCanaryKey(optionId: string, lane: string): `${string}|${string}` {
  return `${optionId}|${lane}`;
}

export function modelCanaryInventory(): Target[] {
  return [
    ...aiModelOptions.filter((option) => isAiModelOptionVisible(option, true)).map((option) => {
      const definition = getAiModelDefinition(option.modelKey);
      return {
        optionId: option.id, label: option.title, model: option.model, capability: "chat" as const, option,
        provider: definition && definition.provider !== "custom" ? getAiProviderInfo(definition.provider)?.byokKey : undefined,
      };
    }),
    ...aiImageModelDefinitions.map((definition) => ({
      optionId: definition.key, label: definition.label, model: definition.gatewayModel, capability: "image" as const,
    })),
  ];
}

export type ModelCanaryState = "never_run" | "enabled" | "disabled";

export type ModelCanaryStateRow = {
  state: ModelCanaryState;
  reason: string | null;
  checkedAt: string | null;
};

function modelCanaryGatewayKeyState(): { key: string; reason: null } | { key: undefined; reason: string } {
  const apiKey = process.env.MODEL_CANARY_AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) return { key: undefined, reason: "missing_internal_gateway_key" };
  if (!/^vck_\S+$/.test(apiKey)) return { key: undefined, reason: "malformed_internal_gateway_key" };
  if (apiKey === process.env.AI_GATEWAY_API_KEY?.trim()) return { key: undefined, reason: "internal_key_equals_trials_key" };
  return { key: apiKey, reason: null };
}

function modelCanaryGatewayKey() {
  return modelCanaryGatewayKeyState().key;
}

function originalError(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== "object") break;
    const nested = current as { cause?: unknown; lastError?: unknown; statusCode?: unknown; status?: unknown };
    if (typeof nested.statusCode === "number" || typeof nested.status === "number") break;
    if (!nested.lastError && !nested.cause) break;
    current = nested.lastError ?? nested.cause;
  }
  return current;
}

export async function probeModelCanary(option: TAiModelOption, lane: string, credential: string | undefined, teamId: string, signal: AbortSignal) {
  const started = Date.now();
  let stage: Stage = lane === "gateway" ? "gateway" : "provider";
  try {
    if (!credential || (lane === "gateway" ? credential !== modelCanaryGatewayKey() : isVercelAiGatewayKey(credential))) {
      return { outcome: "skipped" as const, stage: null, statusCode: null, safeError: "skipped_no_test_key", latencyMs: Date.now() - started };
    }
    const selected = selectModel(option.source, option.model, credential, option, { teamId, userId: FEATURE_FLAG_QA_USER_ID });
    if (selected.resolvedModelId !== option.model) throw new Error("Requested model was replaced before inference");
    const gatewayModel = typeof selected.model !== "string" && selected.model.provider === "gateway";
    if (lane.startsWith("byok:") ? selected.usageProvider !== lane || gatewayModel : selected.usageProvider.startsWith("byok:") || !gatewayModel) {
      return { outcome: "skipped" as const, stage: null, statusCode: null, safeError: "skipped_no_test_key", latencyMs: Date.now() - started };
    }
    const gatewaySlug = option.source === "gateway" ? option.model : `${option.source === "claude" ? "anthropic" : option.source}/${option.model}`;
    const expectedModel = lane === "gateway" ? gatewayCatalogModelSlug(gatewaySlug) : option.directModel ?? (option.source === "gateway" ? option.model.slice(option.model.indexOf("/") + 1) : option.model);
    if (typeof selected.model === "string" || selected.model.modelId !== expectedModel) throw new Error("Requested model was replaced before inference");
    configureAiModelUsage(selected.model, { feature: "model-canary", teamId, userId: FEATURE_FLAG_QA_USER_ID, provider: selected.usageProvider });
    const providerOptions = selected.providerOptions;
    if (providerOptions?.gateway) {
      providerOptions.gateway = { ...providerOptions.gateway, tags: [...(providerOptions.gateway.tags ?? []), "model-canary"] };
    }
    let text = "";
    const result = streamText({
      experimental_download: downloadWithoutBrotli,
      model: selected.model,
      ...selected.settings,
      maxOutputTokens: 2048,
      providerOptions,
      prompt: "Reply with the word OK",
      maxRetries: 0,
      abortSignal: signal,
    });
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error;
      if (part.type === "abort") throw new Error("Model probe timed out");
      if (part.type === "text-delta") text += part.text;
      if (part.type === "finish" && part.finishReason === "error") throw new Error("Model stream finished with an error");
    }
    if (!text.trim()) {
      stage = "empty";
      throw new Error("Model returned empty text");
    }
    return { outcome: "pass" as const, stage: null, statusCode: null, safeError: null, latencyMs: Date.now() - started };
  } catch (error) {
    const original = originalError(error);
    const message = original instanceof Error ? original.message : typeof original === "string" ? original : "Model probe failed";
    const outerMessage = error instanceof Error ? error.message : message;
    if (/pricing/i.test(outerMessage) || /pricing/i.test(message)) stage = "pricing";
    const code = original && typeof original === "object" ? (original as { statusCode?: unknown; status?: unknown }).statusCode ?? (original as { status?: unknown }).status : null;
    const pricingStatus = /pricing returned (\d{3})/.exec(message)?.[1];
    const statusCode = typeof code === "number" && code >= 100 && code <= 599 ? code : pricingStatus ? Number(pricingStatus) : null;
    const withoutCredential = credential ? message.split(credential).join("[redacted]") : message;
    const safeError = redactErrorText(redactSecrets(withoutCredential.replace(/\b[\w-]*headers?[\w-]*\s*[:=][^\r\n]*/gi, "[redacted]")), 300);
    return { outcome: "fail" as const, stage, statusCode, safeError, latencyMs: Date.now() - started };
  }
}

export async function readModelCanaryStatus() {
  const redis = await getRedis();
  const [checkedAt, stored, stateRow] = await Promise.all([redis.get(`${ROOT}:checkedAt`), redis.hvals(LATEST), redis.get(STATE)]);
  const models = stored.map((value) => JSON.parse(value) as ModelCanaryRow).map((row) => ({ ...row, id: row.optionId, status: row.outcome, lastCheckedAt: row.checkedAt }));
  models.sort((a, b) => modelCanaryKey(a.optionId, a.lane).localeCompare(modelCanaryKey(b.optionId, b.lane)));
  const state: ModelCanaryStateRow = stateRow
    ? JSON.parse(stateRow) as ModelCanaryStateRow
    : { state: checkedAt ? "enabled" : "never_run", reason: null, checkedAt };
  const { key, reason } = modelCanaryGatewayKeyState();
  return {
    checkedAt,
    state: state.state,
    reason: state.reason,
    stateCheckedAt: state.checkedAt,
    configured: Boolean(key),
    configuredReason: key ? null : reason,
    models,
  };
}

export async function runModelCanary(): Promise<ModelCanaryCounts> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      executeModelCanary(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Model canary run time budget exhausted")); }, BUDGET_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeModelCanary(signal: AbortSignal): Promise<ModelCanaryCounts> {
  const counts: ModelCanaryCounts = { checked: 0, pass: 0, fail: 0, skipped: 0, inconclusive: 0 };
  const { key: gatewayKey, reason } = modelCanaryGatewayKeyState();
  if (!gatewayKey) {
    await (await getRedis()).set(STATE, JSON.stringify({ state: "disabled", reason, checkedAt: new Date().toISOString() }));
    return counts;
  }
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const redis = await getRedis();
  signal.throwIfAborted();
  const token = randomUUID();
  if (!await redis.set(LOCK, token, "EX", 300, "NX")) return counts;
  try {
    const teams = await prisma.team.findMany({ where: { googleAccount: { userId: FEATURE_FLAG_QA_USER_ID } }, select: { id: true, aiProviderSettings: true }, take: 2 });
    if (teams.length !== 1) throw new Error("Model canary requires exactly one QA-owned team");
    const team = teams[0];
    const targets = modelCanaryInventory();
    const gatewayDecision = await resolveTeamAiFunding(team.id, { provider: "gateway", feature: "gateway" });
    const credentials = new Map<string, string | undefined>(gatewayDecision.mode === "refused" ? [] : [["gateway", gatewayDecision.mode === "byok" ? gatewayDecision.apiKey : gatewayKey]]);
    for (const provider of new Set(targets.flatMap((target) => target.provider ? [target.provider] : []))) {
      signal.throwIfAborted();
      const definition = targets.find((target) => target.provider === provider)?.option;
      const info = definition && getAiModelDefinition(definition.modelKey);
      if (!info || info.provider === "custom" || !resolveTeamProviderEnabled(team.aiProviderSettings, info.provider)) continue;
      const decision = await resolveTeamAiFunding(team.id, { provider, feature: "chat" });
      if (decision.mode === "refused") continue;
      const credential = await resolveTeamByokApiKey(provider, { trustedTeamId: team.id, userId: FEATURE_FLAG_QA_USER_ID });
      if (credential && !isVercelAiGatewayKey(credential) && !(gatewayDecision.mode === "refused" && isPlatformAiCredential(credential))) {
        credentials.set(`byok:${provider}`, credential);
      }
    }
    const work = targets.flatMap((target) => [
      { target, lane: "gateway" },
      ...(target.capability === "chat" && target.provider && credentials.has(`byok:${target.provider}`) ? [{ target, lane: `byok:${target.provider}` }] : []),
    ]);
    const previous = new Map((await redis.hvals(LATEST)).map((value) => {
      const row = JSON.parse(value) as ModelCanaryRow;
      return [modelCanaryKey(row.optionId, row.lane), row] as const;
    }));
    const cursor = await redis.get(`${ROOT}:pending`);
    const pending: string[] = cursor ? JSON.parse(cursor) : [];
    work.sort((a, b) => {
      const left = pending.indexOf(modelCanaryKey(a.target.optionId, a.lane));
      const right = pending.indexOf(modelCanaryKey(b.target.optionId, b.lane));
      return (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right);
    });
    let next = 0;
    const remaining: string[] = [];
    const save = async (field: string, row: ModelCanaryRow) => {
      signal.throwIfAborted();
      if (Number(await redis.eval(SAVE, 2, LOCK, LATEST, token, field, JSON.stringify(row))) !== 1) throw new Error("Model canary lease expired");
    };
    const worker = async () => {
      while (next < work.length) {
        signal.throwIfAborted();
        const { target, lane } = work[next++];
        const field = modelCanaryKey(target.optionId, lane);
        const prior = previous.get(field);
        const checkedAt = new Date().toISOString();
        const row: ModelCanaryRow = {
          optionId: target.optionId, label: target.label, model: target.model, capability: target.capability, lane,
          outcome: "inconclusive", stage: null, statusCode: null, safeError: "Run time budget exhausted", latencyMs: 0, checkedAt,
          lastPassAt: prior?.lastPassAt ?? null,
          dailyFailDates: (prior?.dailyFailDates ?? []).filter((date) => date >= new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)),
        };
        if (target.capability === "image" || target.option?.source === "custom") {
          row.outcome = "skipped";
          row.safeError = target.capability === "image" ? "Image generation is not probed" : "skipped_no_test_key";
        } else if (Date.now() < deadline - PROBE_MS && await redis.get(LOCK) === token) {
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(() => { controller.abort(); reject(new Error("Model probe timed out")); }, PROBE_MS);
            });
            Object.assign(row, await Promise.race([probeModelCanary(target.option!, lane, credentials.get(lane), team.id, AbortSignal.any([signal, controller.signal])), timeout]));
          } catch {
            Object.assign(row, { outcome: "fail", stage: lane === "gateway" ? "gateway" : "provider", safeError: "Model probe timed out", latencyMs: PROBE_MS });
          } finally {
            if (timer) clearTimeout(timer);
          }
        } else {
          remaining.push(field);
        }
        row.checkedAt = new Date().toISOString();
        const failureDay = row.checkedAt.slice(0, 10);
        const firstFail = row.outcome === "fail" && !row.dailyFailDates.includes(failureDay);
        if (row.outcome === "pass") row.lastPassAt = row.checkedAt;
        if (firstFail) row.dailyFailDates = [...row.dailyFailDates, failureDay].slice(-7);
        await save(field, row);
        counts.checked++;
        counts[row.outcome]++;
        if (firstFail) {
          await reportError({
            source: "server", minimumOccurrences: 1,
            fingerprintKey: `model-canary:${target.optionId}:${lane}:${failureDay}`,
            message: `Model canary failed: ${target.optionId} (${lane}) on ${failureDay}`,
            url: "/api/cron/ai-model-canary",
            extra: { optionId: target.optionId, model: target.model, lane, stage: row.stage, statusCode: row.statusCode, safeError: row.safeError },
          });
        }
      }
    };
    const workers = await Promise.allSettled(Array.from({ length: 4 }, worker));
    const failed = workers.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    signal.throwIfAborted();
    await redis.eval(`
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2])
redis.call("SET", KEYS[3], ARGV[3])
redis.call("SET", KEYS[4], ARGV[4])
return 1
`, 4, LOCK, `${ROOT}:pending`, `${ROOT}:checkedAt`, STATE, token, JSON.stringify(remaining), new Date().toISOString(),
      JSON.stringify({ state: "enabled", reason: null, checkedAt: new Date().toISOString() }));
  } finally {
    await redis.eval(RELEASE, 1, LOCK, token);
  }
  return counts;
}
