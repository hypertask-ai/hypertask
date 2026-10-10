import { ensureHtpr7038ModelReset } from "@/lib/ai/htpr7038ModelReset";
export { escapeHtml } from "./editorAiPrompts";

export { NVC_STYLE_RULE, HOUSE_OUTPUT_STYLE, TASK_AUTHORING_STYLE, createPromptForTiptapForwardSlash, createKanbanSystemPrompt, createTaskAndModelContext, createUploadedDocumentsContext, createTaskWriterPromptParts } from "./editorAiPrompts";
import { cookies } from "next/headers";

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel, type FilePart, type LanguageModel, type ToolSet, type UserContent } from "ai";
import { searchComments, searchTasks, type TurbopufferCommentRow, type TurbopufferTaskRow } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { retrieveCustomInstructionFileContext } from "@/app/api/ai/_lib/customInstructions";
import { configureAiModelUsage, inheritAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { getAiDefaultModelContext, getByokOrTeamGatewayApiKeyForProvider, getByokOrTeamGatewayApiKeyForModelOption, getTeamGatewayApiKey, type ByokProviderFlag } from "@/app/api/ai/_lib/byokKeys";
import { sharedAiAllowanceErrorMessage } from "@/app/api/ai/_lib/sharedAllowance";
import { previousModelForFailedStream } from "@/app/api/ai/chat/stream/modelFallback";
import { filterModelOptionForTeam, getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { aiUsageProviderForCredential, isCustomEndpointConfig, isVercelAiGatewayKey, providerOptionsForAiModel, resolveAiModel, type AiModelCredential, type AiGatewayTags, type AiProviderOptions, type AiGatewayFeature } from "@/app/api/ai/_lib/modelProvider";
import { defaultAiModelOption, getDefaultAiModelOptionForPlan, getAiModelOptionById, isLunaBlockedForPlan, preferredAiModelOption, resolveHaikuModelId, type TAiModelOption } from "@/lib/aiModelOptions";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";
import { resolveUserFacingModelOption, type UserFacingModelFeature } from "@/lib/systemModelLadder";
import { getAiModelPreferenceIds, type TAiModelPreferenceSurface, type TAiModelPreferences } from "@/lib/aiModelPreferences";
import { assertModelAllowedForPlan, haiku55ModelEnabled, lunaFreePlanEnabled, storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { excludeLoadedTaskRows } from "@/app/api/ai/_lib/taskWriterPrompt";
import { mergeTaskWriterContextBudget } from "@/app/api/ai/_lib/taskWriterBoardResearch";

import prisma from "@/lib/prisma";
import { HTPR_7038_TASK_WRITER_SONNET_FLAG } from "@/lib/flags/keys";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export type ProviderId =
  "claude" | "openai" | "openrouter" | "gateway" | "custom";

export type CookieUser = {
  id?: number;
  email?: string;
  displayName?: string;
};

export type TaskWriterFile = {
  fileName?: string | null;
  url?: string | null;
  base64?: string | null;
  data?: string | null;
  mimeType?: string | null;
  type?: string | null;
};

export type SelectedModel = {
  provider: ProviderId;
  usageProvider: string;
  modelId: string;
  model: LanguageModel;
  providerOptions?: AiProviderOptions;
  settings: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  tools?: ToolSet;
};

const DEFAULT_PROVIDER: ProviderId = "openai";
const DEFAULT_MODEL = "gpt-6-luna";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5.5";
const CLAUDE_MODELS = new Set([
  "claude-sonnet-5.5",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-opus-5.5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-haiku-4.5",
  "claude-haiku-5.5",
  "claude-haiku-5-5",
]);
const OPENAI_MODELS = new Set([
  "gpt-6-luna",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-5.6-sol",
]);

const CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES = [
  "claude-opus",
  "claude-sonnet-5",
  "claude-haiku-5",
] as const;

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_SRC_RE = /src\s*=\s*["']([^"']+)["']/i;
const CODE_FENCE_OPEN_RE = /^\s*```[a-zA-Z0-9]*[ \t]*\r?\n?/;
const CODE_FENCE_CLOSE_RE = /\r?\n?[ \t]*```\s*$/;

export async function getCurrentUserFromCookies(): Promise<CookieUser | null> {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    if (!userCookie?.value) return null;
    return JSON.parse(userCookie.value) as CookieUser;
  } catch (error) {
    console.log("getCurrentUserFromCookies error:", error);
    return null;
  }
}

export function sseFrame(
  event: string,
  data: Record<string, unknown> | string
) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export function createSseErrorResponse(message: string, status = 401) {
  return new Response(
    sseFrame("error", { content: message }) +
      sseFrame("done", { status: "error" }),
    { status, headers: SSE_HEADERS }
  );
}

export function errorMessage(error: unknown) {
  const allowanceMessage = sharedAiAllowanceErrorMessage(error);
  if (allowanceMessage) return allowanceMessage;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Sorry, an error occurred while processing your request.";
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stripCodeFences(text: string) {
  try {
    if (!text) return text;
    let trimmed = text.trim();
    trimmed = trimmed.replace(CODE_FENCE_OPEN_RE, "");
    trimmed = trimmed.replace(CODE_FENCE_CLOSE_RE, "");
    return trimmed.trim();
  } catch {
    return text;
  }
}

function imgSrc(tag: string) {
  const match = IMG_SRC_RE.exec(tag || "");
  return match?.[1];
}

export function reinjectMissingImages(inputHtml: string, outputHtml: string) {
  try {
    const inputTags = Array.from((inputHtml || "").matchAll(IMG_TAG_RE)).map(
      (match) => match[0]
    );
    if (inputTags.length === 0) return outputHtml;

    const outputSrcs = new Set(
      Array.from((outputHtml || "").matchAll(IMG_TAG_RE))
        .map((match) => imgSrc(match[0]))
        .filter((src): src is string => Boolean(src))
    );
    const seen = new Set<string>();
    const missing: string[] = [];

    for (const tag of inputTags) {
      const src = imgSrc(tag);
      if (!src || outputSrcs.has(src) || seen.has(src)) continue;
      seen.add(src);
      missing.push(tag);
    }

    if (missing.length === 0) return outputHtml;
    return (outputHtml || "") + missing.map((tag) => `<p>${tag}</p>`).join("");
  } catch {
    return outputHtml;
  }
}

export function normalizeTiptapOutput(inputHtml: string, outputHtml: string) {
  return reinjectMissingImages(inputHtml, stripCodeFences(outputHtml));
}

// HTML-canvas blocks (Pages) are opaque base64 islands rendered only in a
// sandboxed iframe. Their payload is useless to the language model and would be
// dropped or corrupted by an AI edit, so we pull them out before the model runs
// and splice them back afterwards. Mirrors the image-preservation approach above.
const HTML_BLOCK_RE = /<div\b[^>]*\bdata-html-block\b[^>]*><\/div>/gi;
const HTML_BLOCK_PLACEHOLDER_RE = /<!--HTMLBLOCK_(\d+)-->/g;

export function extractHtmlBlocks(html: string): {
  stripped: string;
  blocks: string[];
} {
  const blocks: string[] = [];
  const stripped = (html || "").replace(HTML_BLOCK_RE, (match) => {
    const index = blocks.length;
    blocks.push(match);
    return `<!--HTMLBLOCK_${index}-->`;
  });
  return { stripped, blocks };
}

export function reattachHtmlBlocks(html: string, blocks: string[]): string {
  if (blocks.length === 0) return html || "";
  const used = new Set<number>();
  let out = (html || "").replace(HTML_BLOCK_PLACEHOLDER_RE, (_match, n) => {
    const index = Number(n);
    if (blocks[index] != null) {
      used.add(index);
      return blocks[index];
    }
    return "";
  });
  // Append any block whose marker the model dropped, so a canvas block is never
  // lost to an AI edit (worst case it moves to the end, never disappears).
  const lost = blocks.filter((_, index) => !used.has(index));
  if (lost.length > 0) out += lost.join("");
  return out;
}

export function extractImgSrcs(htmlText: string) {
  const srcs = new Set<string>();
  for (const match of (htmlText || "").matchAll(IMG_TAG_RE)) {
    const src = imgSrc(match[0]);
    if (src) srcs.add(src.trim());
  }
  return srcs;
}

export function filterOneImagePass(text: string, allowedSrcs: Set<string>) {
  const out: string[] = [];
  let i = 0;
  const lower = text.toLowerCase();

  while (true) {
    const start = lower.indexOf("<img", i);
    if (start === -1) {
      const rest = text.slice(i);
      let keep = 0;
      for (let k = Math.min(4, rest.length); k > 0; k--) {
        if ("<img".startsWith(rest.slice(-k).toLowerCase())) {
          keep = k;
          break;
        }
      }
      if (keep) {
        out.push(rest.slice(0, -keep));
        return { emit: out.join(""), leftover: rest.slice(-keep) };
      }
      out.push(rest);
      return { emit: out.join(""), leftover: "" };
    }

    out.push(text.slice(i, start));
    const end = text.indexOf(">", start);
    if (end === -1) {
      return { emit: out.join(""), leftover: text.slice(start) };
    }

    const tag = text.slice(start, end + 1);
    const src = imgSrc(tag)?.trim();
    if (src && allowedSrcs.has(src)) out.push(tag);
    i = end + 1;
  }
}

export function normalizeProvider(sourceSelected?: string | null): ProviderId {
  const source = (sourceSelected ?? "").trim().toLowerCase();
  if (
    source === "claude" ||
    source === "openai" ||
    source === "openrouter" ||
    source === "gateway" ||
    source === "custom"
  ) {
    return source;
  }
  return DEFAULT_PROVIDER;
}

function claudeAcceptsTemperature(model: string | null | undefined) {
  const normalized = String(model || "").toLowerCase();
  return !CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

function selectionFromModelOption(option: TAiModelOption): {
  provider: ProviderId;
  model: string;
  modelOption: TAiModelOption;
} {
  return {
    provider: option.source,
    model: option.model,
    modelOption: option,
  };
}

export function defaultModelSelection(
  settings?: unknown,
  feature: UserFacingModelFeature = "taskWriter",
  personalModelOptionId?: string | null,
  customEndpointConfigured = true,
  defaultModelOption = defaultAiModelOption,
  haiku55Enabled = defaultModelOption.modelKey === "claude-haiku-5-5",
) {
  const option = resolveUserFacingModelOption(
    feature,
    settings,
    personalModelOptionId,
    { customEndpointConfigured, defaultModelOption, haiku55Enabled }
  );
  if (!option) throw new Error("This AI feature is turned off for your team");
  return selectionFromModelOption(filterModelOptionForTeam(option, settings, haiku55Enabled));
}

function resolveTaskWriterSelection(
  sourceSelected?: string | null,
  modelSelected?: string | null,
  modelOptionId?: string | null,
  defaultModelOption = defaultAiModelOption,
  haiku55Enabled = defaultModelOption.modelKey === "claude-haiku-5-5",
): { provider: ProviderId; model: string; modelOption?: TAiModelOption } {
  const provider = normalizeProvider(sourceSelected);
  const requestedModel = modelSelected?.trim();

  if (provider === "openrouter") {
    return requestedModel
      ? { provider, model: requestedModel }
      : defaultModelSelection(
          undefined,
          "taskWriter",
          undefined,
          true,
          defaultModelOption,
          haiku55Enabled,
        );
  }

  const modelOption =
    getAiModelOptionById(modelOptionId, haiku55Enabled) ?? getAiModelOptionById(requestedModel, haiku55Enabled);
  if (modelOption) {
    return selectionFromModelOption(modelOption);
  }

  return defaultModelSelection(
    undefined,
    "taskWriter",
    undefined,
    true,
    defaultModelOption,
    haiku55Enabled,
  );
}

function normalizeGatewayTeamId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function gatewayTagsForLookup(args?: {
  teamId?: unknown;
  projectId?: number | null;
  userId?: number | null;
}): AiGatewayTags | undefined {
  const teamId = normalizeGatewayTeamId(args?.teamId);
  const projectId = args?.projectId ?? null;
  const userId = args?.userId ?? null;
  if (!teamId && projectId == null && userId == null) return undefined;
  return { teamId, projectId, userId };
}

export async function selectTiptapModel(args?: {
  teamId?: unknown;
  projectId?: number | null;
  userId?: number | null;
  taskId?: number | null;
  agentId?: string | null;
  teamContext?: { teamId: string | null; settings: unknown };
}): Promise<SelectedModel> {
  const selected = await selectTaskWriterModel({
    teamId: args?.teamId,
    projectId: args?.projectId,
    userId: args?.userId,
    feature: "editor",
    aiFeature: "improveWriting",
    agentId: args?.agentId ?? null,
    teamContext: args?.teamContext,
  });

  configureAiModelUsage(selected.model, {
    userId: args?.userId,
    teamId: selected.teamId,
    projectId: args?.projectId,
    taskId: args?.taskId,
    agentId: args?.agentId,
    provider: selected.usageProvider,
    feature: "editor",
  });
  return selected;
}

export function selectEditorModel(
  provider: ProviderId,
  modelId: string | null | undefined,
  byokCredential?: AiModelCredential,
  options?: {
    includeNativeWebSearch?: boolean;
    feature?: AiGatewayFeature;
    tags?: AiGatewayTags;
    modelOption?: TAiModelOption;
  }
): SelectedModel {
  const requestedModel = modelId?.trim() || undefined;
  const feature = options?.feature ?? "task-writer";
  const usageProvider = aiUsageProviderForCredential(
    provider,
    byokCredential,
    options?.modelOption
  );

  switch (provider) {
    case "claude": {
      const model =
        requestedModel && CLAUDE_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_CLAUDE_MODEL;
      const directModel = typeof byokCredential === "string" &&
        !isVercelAiGatewayKey(byokCredential)
        ? options?.modelOption?.directModel ?? model
        : model;
      const aiModel = resolveAiModel(provider, directModel, byokCredential);
      const directApiKey = isVercelAiGatewayKey(byokCredential)
        ? undefined
        : typeof byokCredential === "string"
          ? byokCredential
          : undefined;
      const anthropic = createAnthropic({
        apiKey: directApiKey ?? "",
      });
      return {
        provider,
        usageProvider,
        modelId: model,
        model: aiModel,
        providerOptions: providerOptionsForAiModel(
          aiModel,
          feature,
          options?.tags,
          options?.modelOption
        ),
        settings: {
          ...(claudeAcceptsTemperature(model) ? { temperature: 0.2 } : {}),
          maxOutputTokens: 16000,
        },
        tools: options?.includeNativeWebSearch
          ? ({
              web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
            } as ToolSet)
          : undefined,
      };
    }
    case "openrouter": {
      if (!requestedModel) {
        return selectEditorModel(
          DEFAULT_PROVIDER,
          DEFAULT_MODEL,
          undefined,
          options
        );
      }
      const aiModel = resolveAiModel(provider, requestedModel, byokCredential);
      return {
        provider,
        usageProvider,
        modelId: requestedModel,
        model: aiModel,
        providerOptions: providerOptionsForAiModel(
          aiModel,
          feature,
          options?.tags
        ),
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
    case "gateway": {
      const model = requestedModel || defaultAiModelOption.model;
      const aiModel = resolveAiModel(
        provider,
        model,
        byokCredential,
        options?.modelOption
      );
      return {
        provider,
        usageProvider,
        modelId: model,
        model: aiModel,
        providerOptions: providerOptionsForAiModel(
          aiModel,
          feature,
          options?.tags,
          options?.modelOption
        ),
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
    case "custom": {
      if (!isCustomEndpointConfig(byokCredential)) {
        throw new Error("A complete custom endpoint is required");
      }
      const aiModel = resolveAiModel(provider, "custom", byokCredential);
      return {
        provider,
        usageProvider,
        modelId: byokCredential.modelId,
        model: aiModel,
        providerOptions: undefined,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
    case "openai":
    default: {
      const model =
        requestedModel && OPENAI_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_MODEL;
      const aiModel = resolveAiModel("openai", model, byokCredential);
      const directApiKey = isVercelAiGatewayKey(byokCredential)
        ? undefined
        : typeof byokCredential === "string"
          ? byokCredential
          : undefined;
      const openai = createOpenAI({
        apiKey: directApiKey ?? "",
      });
      return {
        provider: "openai",
        usageProvider,
        modelId: model,
        model: aiModel,
        providerOptions: providerOptionsForAiModel(
          aiModel,
          feature,
          options?.tags,
          options?.modelOption
        ),
        settings: {
          temperature: /^gpt-([5-9]|\d{2,})/.test(model.toLowerCase()) ? 1 : 0.2,
          maxOutputTokens: 16000,
        },
        tools: options?.includeNativeWebSearch
          ? ({ web_search: openai.tools.webSearch() } as ToolSet)
          : undefined,
      };
    }
  }
}

const PERSONAL_MODEL_SURFACES: Partial<
  Record<UserFacingModelFeature, TAiModelPreferenceSurface>
> = {
  aiChat: "aiChat",
  taskWriter: "taskWriter",
  writeWithAi: "writeWithAi",
  improveWriting: "improveWriting",
  askAi: "askAi",
};

async function getPersonalModelOptionId(
  userId: number | null | undefined,
  teamId: string | null,
  feature: UserFacingModelFeature
) {
  const surface = PERSONAL_MODEL_SURFACES[feature];
  if (!userId || !surface) return null;
  await ensureHtpr7038ModelReset(userId);
  const userSetting = await prisma.userSetting.findUnique({
    where: { userId },
    select: { aiModelPreferences: true },
  });
  const ids = getAiModelPreferenceIds(
    userSetting?.aiModelPreferences as TAiModelPreferences | null | undefined,
    surface,
    teamId
  );
  return ids.teamScoped ?? ids.global ?? null;
}

export async function selectTaskWriterModel(args: {
  sourceSelected?: string | null;
  modelSelected?: string | null;
  modelOptionId?: string | null;
  byokProviderFlags?: ByokProviderFlag[] | null;
  teamId?: unknown;
  projectId?: number | null;
  userId?: number | null;
  feature?: AiGatewayFeature;
  aiFeature?: UserFacingModelFeature;
  teamContext?: { teamId: string | null; settings: unknown };
  /**
   * The native agent this call runs as, when there is one. An agent carrying
   * its own provider credential runs on that account instead of the team's
   * (HTPR-5389). Server-derived only, never request input.
   */
  agentId?: string | null;
  /** Preserve legacy task-writer credential routing when the Sonnet flag is off. */
  taskWriterAgentId?: string | null;
}) {
  let taskWriterSonnet = false;
  if (args.aiFeature === "taskWriter" && args.userId) {
    try {
      const { isFeatureEnabled } = await import("@/lib/flags");
      taskWriterSonnet = await isFeatureEnabled(HTPR_7038_TASK_WRITER_SONNET_FLAG, args.userId);
    } catch {
      // A flag read failure must keep the existing task-writer selection.
    }
  }
  const agentId = args.agentId ?? (taskWriterSonnet ? args.taskWriterAgentId : null);
  const teamContext =
    args.teamContext ??
    (await getProjectTeamProviderContext(args.projectId, args.userId));
  const keyLookup = teamContext.teamId
    ? {
        trustedTeamId: teamContext.teamId,
        userId: args.userId,
        agentId: agentId ?? null,
      }
    : {
        teamId: args.teamId,
        projectId: args.projectId,
        userId: args.userId,
        agentId: agentId ?? null,
      };
  const storePlanId = await storePlanIdForProject(
    teamContext.teamId ? undefined : args.projectId,
    teamContext.teamId,
  );
  let hasEligibleByokCredential = false;
  if (storePlanId === "BYOK") {
    const credential = await getByokOrTeamGatewayApiKeyForModelOption(
      preferredAiModelOption,
      args.byokProviderFlags,
      keyLookup,
    );
    const sharedKey = process.env.AI_GATEWAY_API_KEY?.trim();
    hasEligibleByokCredential =
      (typeof credential === "string" &&
        credential.trim().length > 0 &&
        credential.trim() !== sharedKey) ||
      (credential !== null && typeof credential === "object");
  }
  const lunaFree = await lunaFreePlanEnabled(args.userId);
  const haiku55Enabled = await haiku55ModelEnabled?.(args.userId) ?? false;
  const defaultContext = haiku55Enabled
    ? await getAiDefaultModelContext(keyLookup, true, storePlanId)
    : { hasByok: false, byok: undefined, haikuDefaultEnabled: false, backgroundClaudeEnabled: false };
  const requestDefaultModelOption = getDefaultAiModelOptionForPlan(
    storePlanId,
    haiku55Enabled ? defaultContext.hasByok : hasEligibleByokCredential,
    lunaFree,
    haiku55Enabled,
    defaultContext.haikuDefaultEnabled,
  );
  const personalModelOptionId = args.aiFeature && !taskWriterSonnet
    ? await getPersonalModelOptionId(
        args.userId,
        teamContext.teamId,
        args.aiFeature
      )
    : null;
  let selection = taskWriterSonnet
    ? selectionFromModelOption(getAiModelOptionById("claude-sonnet-5-5-thinking")!)
    : args.aiFeature
    ? defaultModelSelection(
        teamContext.settings,
        args.aiFeature,
        personalModelOptionId,
        true,
        requestDefaultModelOption,
        haiku55Enabled,
      )
    : resolveTaskWriterSelection(
        args.sourceSelected,
        args.modelSelected,
        args.modelOptionId,
        requestDefaultModelOption,
        haiku55Enabled,
      );
  if (selection.modelOption) {
    selection = selectionFromModelOption(
      filterModelOptionForTeam(selection.modelOption, teamContext.settings, haiku55Enabled)
    );
  }
  if (
    isLunaBlockedForPlan(
      selection.modelOption,
      storePlanId,
      lunaFree,
      hasEligibleByokCredential,
    )
  ) {
    selection = selectionFromModelOption(
      filterModelOptionForTeam(requestDefaultModelOption, teamContext.settings, haiku55Enabled),
    );
  }

  const haikuByok = defaultContext.byok?.provider === "openrouter" &&
    !resolveTeamProviderEnabled(teamContext.settings, "openrouter")
    ? undefined : defaultContext.byok;
  const getSelectionApiKey = (
    selected: ReturnType<typeof resolveTaskWriterSelection>
  ) =>
    selected.modelOption?.modelKey === "claude-haiku-5-5" && haikuByok
      ? Promise.resolve(haikuByok.credential)
      : selected.modelOption
      ? getByokOrTeamGatewayApiKeyForModelOption(
          selected.modelOption,
          args.byokProviderFlags,
          keyLookup
        )
      : selected.provider === "gateway"
        ? getTeamGatewayApiKey(keyLookup)
        : getByokOrTeamGatewayApiKeyForProvider(
            selected.provider,
            args.byokProviderFlags,
            keyLookup
          );
  let byokApiKey = await getSelectionApiKey(selection);

  if (selection.provider === "custom" && !isCustomEndpointConfig(byokApiKey)) {
    selection = defaultModelSelection(
      teamContext.settings,
      args.aiFeature ?? "taskWriter",
      personalModelOptionId,
      false,
      requestDefaultModelOption,
      haiku55Enabled,
    );
    byokApiKey = await getSelectionApiKey(selection);
  }

  if (selection.provider === "openrouter") {
    if (isVercelAiGatewayKey(byokApiKey)) {
      selection = defaultModelSelection(
        teamContext.settings,
        args.aiFeature ?? "taskWriter",
        personalModelOptionId,
        true,
        requestDefaultModelOption,
        haiku55Enabled,
      );
    } else if (!byokApiKey) {
      selection = defaultModelSelection(
        teamContext.settings,
        args.aiFeature ?? "taskWriter",
        personalModelOptionId,
        true,
        requestDefaultModelOption,
        haiku55Enabled,
      );
      byokApiKey = await getSelectionApiKey(selection);
    }
  }

  if (selection.modelOption?.modelKey === "claude-haiku-5-5" && haikuByok?.provider === "openrouter") {
    selection = { ...selection, provider: "openrouter", model: "anthropic/claude-haiku-5.5" };
  }

  const pinnedSonnet = taskWriterSonnet && selection.modelOption?.modelKey === "claude-sonnet-5-5";
  if (pinnedSonnet && selection.modelOption) {
    // Apply after provider filtering, which restores the catalog option by id.
    selection.modelOption = {
      ...selection.modelOption,
      effort: "standard",
      providerOptions: {
        anthropic: { thinking: { type: "adaptive" }, effort: "medium" },
      },
    };
  }
  // Free and keyless BYOK keep their existing capped shared allowance for this pin.
  if (!(pinnedSonnet && (storePlanId === "Free" || storePlanId === "BYOK"))) {
    await assertModelAllowedForPlan(
      args.projectId,
      selection.modelOption,
      teamContext.teamId,
      byokApiKey,
      lunaFree,
    );
  }

  const tags = gatewayTagsForLookup({
    teamId: teamContext.teamId ?? args.teamId,
    projectId: args.projectId,
    userId: args.userId,
  });
  const selectedModel = selectEditorModel(
    selection.provider,
    selection.model,
    byokApiKey,
    {
      feature: args.feature ?? "task-writer",
      tags,
      modelOption: selection.modelOption,
      includeNativeWebSearch:
        selection.provider === "claude" || selection.provider === "openai",
    }
  );
  const selected = {
    ...selectedModel,
    modelId: resolveHaikuModelId(selectedModel.modelId, haiku55Enabled),
    teamId: teamContext.teamId ?? normalizeGatewayTeamId(args.teamId),
  };
  const sameModelRetry = Boolean(defaultContext.backgroundClaudeEnabled);
  let hasOutput = false;
  let fellBack = false;
  const fallbackModel = async (error: unknown) => {
    if (fellBack) return null;
    const previous = previousModelForFailedStream(
      selected.modelId, error, hasOutput, false, haiku55Enabled, sameModelRetry,
    );
    if (previous && previous.model === selected.modelId) {
      // HTPR-7075: retry the same Claude 5.5 model once, then fail visibly.
      fellBack = true;
      console.warn(`[ai-model-fallback] ${selected.modelId} retry on the same model: ${previous.status}`);
      return {
        model: selectedModel.model as LanguageModelV4,
        providerOptions: selected.providerOptions,
        crossProvider: false,
      };
    }
    if (!previous || (previous.model === "gpt-6-luna" && !resolveTeamProviderEnabled(teamContext.settings, "openai"))) return null;
    fellBack = true;
    console.warn(
      `[ai-model-fallback] ${selected.modelId} -> ${previous.model}: ${previous.status}`,
    );
    const fallbackCredential = previous.model === "gpt-6-luna" && !isVercelAiGatewayKey(byokApiKey)
      ? await getByokOrTeamGatewayApiKeyForModelOption(
          getAiModelOptionById(previous.model)!, args.byokProviderFlags, keyLookup,
        )
      : byokApiKey;
    const fallback = selectEditorModel(
      previous.model === "gpt-6-luna" ? "openai" : selection.provider,
      previous.model,
      fallbackCredential,
      {
        feature: args.feature ?? "task-writer",
        tags,
        modelOption: previous.model === "gpt-6-luna"
          ? getAiModelOptionById(previous.model)
          : selection.modelOption ? { ...selection.modelOption, directModel: undefined } : undefined,
      },
    );
    inheritAiModelUsage(fallback.model, selected.model);
    if (previous.model === "gpt-6-luna") {
      configureAiModelUsage(fallback.model, { provider: fallback.usageProvider });
    }
    selected.modelId = fallback.modelId;
    selected.provider = fallback.provider;
    selected.usageProvider = fallback.usageProvider;
    selected.providerOptions = fallback.providerOptions;
    if (fallback.provider !== selection.provider) selected.tools = fallback.tools;
    return {
      model: fallback.model as LanguageModelV4,
      providerOptions: fallback.providerOptions,
      crossProvider: fallback.provider !== selection.provider,
    };
  };
  if (!previousModelForFailedStream(selected.modelId, { status: 404 }, false, false, haiku55Enabled, sameModelRetry)) {
    return selected;
  }
  selected.model = wrapLanguageModel({
    model: selectedModel.model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate, params }) => {
        try {
          const result = await doGenerate();
          hasOutput = true;
          return result;
        } catch (error) {
          const fallback = await fallbackModel(error);
          if (!fallback) throw error;
          const result = await fallback.model.doGenerate({
            ...params,
            ...(fallback.crossProvider ? { tools: params.tools?.filter((tool) => tool.type !== "provider") } : {}),
            providerOptions: fallback.providerOptions ?? {},
          });
          hasOutput = true;
          return result;
        }
      },
      wrapStream: async ({ doStream, params }) => {
        let result;
        try {
          result = await doStream();
        } catch (error) {
          const fallback = await fallbackModel(error);
          if (!fallback) throw error;
          result = await fallback.model.doStream({
            ...params,
            ...(fallback.crossProvider ? { tools: params.tools?.filter((tool) => tool.type !== "provider") } : {}),
            providerOptions: fallback.providerOptions ?? {},
          });
        }
        let reader = result.stream.getReader();
        let cancelled = false;
        let cancelReason: unknown;
        let finished = false;
        let preamble: Array<Extract<Awaited<ReturnType<typeof reader.read>>, { done: false }>["value"]> = [];
        let pending: typeof preamble = [];
        const switchReader = async (fallback: NonNullable<Awaited<ReturnType<typeof fallbackModel>>>) => {
          const next = (await fallback.model.doStream({
            ...params,
            ...(fallback.crossProvider ? { tools: params.tools?.filter((tool) => tool.type !== "provider") } : {}),
            providerOptions: fallback.providerOptions ?? {},
          })).stream.getReader();
          reader = next;
          if (cancelled) await next.cancel(cancelReason);
        };
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              try {
                while (true) {
                  if (pending.length) {
                    controller.enqueue(pending.shift()!);
                    return;
                  }
                  if (finished) {
                    controller.close();
                    return;
                  }
                  let item;
                  try {
                    item = await reader.read();
                  } catch (error) {
                    const fallback = await fallbackModel(error);
                    if (!fallback) throw error;
                    await switchReader(fallback);
                    preamble = [];
                    continue;
                  }
                  if (cancelled) return;
                  if (item.done) {
                    pending = preamble;
                    preamble = [];
                    finished = true;
                    continue;
                  }
                  if (item.value.type === "stream-start" || item.value.type === "response-metadata") {
                    preamble.push(item.value);
                    continue;
                  }
                  if (item.value.type === "error") {
                    const fallback = await fallbackModel(item.value.error);
                    if (fallback) {
                      await reader.cancel();
                      await switchReader(fallback);
                      preamble = [];
                      continue;
                    }
                  } else {
                    hasOutput = true;
                  }
                  pending = [...preamble, item.value];
                  preamble = [];
                }
              } catch (error) {
                if (!cancelled) controller.error(error);
              }
            },
            cancel(reason) {
              cancelled = true;
              cancelReason = reason;
              return reader.cancel(reason);
            },
          }),
        };
      },
    },
  });
  inheritAiModelUsage(selected.model, selectedModel.model);
  return selected;
}

function dataUrlToFilePart(
  value: string,
  mediaType: string,
  filename?: string | null
): FilePart | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(value);
  if (!match) return null;
  return {
    type: "file",
    mediaType: mediaType || match[1] || "application/octet-stream",
    filename: filename ?? undefined,
    data: { type: "data", data: match[3] || "" },
  };
}

export function filePartFromTaskWriterFile(
  file: TaskWriterFile
): FilePart | null {
  const raw = file.url || file.base64 || file.data;
  if (!raw) return null;
  const mediaType = file.mimeType || file.type || "application/octet-stream";
  const dataUrl = dataUrlToFilePart(raw, mediaType, file.fileName);
  if (dataUrl) return dataUrl;

  const looksBase64 =
    /^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.replace(/\s/g, "").length > 100;
  if (looksBase64 && !raw.startsWith("http")) {
    return {
      type: "file",
      mediaType,
      filename: file.fileName ?? undefined,
      data: { type: "data", data: raw.replace(/\s/g, "") },
    };
  }

  try {
    return {
      type: "file",
      mediaType,
      filename: file.fileName ?? undefined,
      data: new URL(raw),
    };
  } catch {
    return null;
  }
}

export function createTaskWriterUserContent(
  input: string,
  files: TaskWriterFile[]
): UserContent {
  const fileParts = files
    .map(filePartFromTaskWriterFile)
    .filter((part): part is FilePart => part !== null);
  if (fileParts.length === 0) return input;
  return [{ type: "text", text: input }, ...fileParts];
}

function taskRowToContext(row: TurbopufferTaskRow) {
  return [
    `taskId:${row.uniqueIndex}`,
    `projectId:${row.projectId}`,
    row.ticketNumber ? `ticketNumber:${row.ticketNumber}` : "",
    row.title ? `title:${row.title}` : "",
    row.descriptionText ? `description:${row.descriptionText}` : "",
    row.status ? `status:${row.status}` : "",
    row.projectTitle ? `project:${row.projectTitle}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function commentRowToContext(row: TurbopufferCommentRow) {
  return [
    `taskId:${row.taskUniqueIndex}`,
    `projectId:${row.projectId}`,
    `commentId:${row.id}`,
    row.taskTicketNumber ? `ticketNumber:${row.taskTicketNumber}` : "",
    row.taskTitle ? `taskTitle:${row.taskTitle}` : "",
    row.commentText ? `comment:${row.commentText}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function retrieveTaskWriterContext(args: {
  projectId: number;
  projectIds?: number[];
  prompt: string;
  aiMode?: string | null;
  taskIds?: number[];
  /** HTPR-6363: keep comment rows when a busy board fills the task budget. */
  reserveCommentBudget?: boolean;
}) {
  const taskIds = (args.taskIds ?? []).filter((id) => Number.isInteger(id));
  const projectIds = args.projectIds?.length
    ? args.projectIds
    : [args.projectId];

  const [taskRowsRaw, commentRowsRaw, customInstructionFileContext] =
    await Promise.all([
      searchTasks({
        searchQuery: args.prompt,
        projectIds,
        topK: 50,
      }),
      searchComments({
        searchQuery: args.prompt,
        projectIds,
        topK: 60,
        limit: 50,
      }),
      retrieveCustomInstructionFileContext({
        projectId: args.projectId,
        prompt: args.prompt,
      }),
    ]);

  // Full content for every supplied ticket is loaded separately. Exclude those
  // tickets from semantic results so a prompt-similar comment is not repeated
  // and accidentally weighted more heavily than the rest of its thread.
  const excluded = excludeLoadedTaskRows({
    taskRows: taskRowsRaw,
    commentRows: commentRowsRaw,
    loadedTaskIds: taskIds,
  });
  const { taskRows, commentRows } = args.reserveCommentBudget
    ? mergeTaskWriterContextBudget(excluded)
    : {
        taskRows: excluded.taskRows,
        commentRows: excluded.commentRows,
      };

  const rankedRows = args.reserveCommentBudget
    ? [...taskRows.map(taskRowToContext), ...commentRows.map(commentRowToContext)]
    : [...taskRows.map(taskRowToContext), ...commentRows.map(commentRowToContext)].slice(
        0,
        50
      );

  const projectContext = rankedRows.join("\n\n");

  return [projectContext, customInstructionFileContext]
    .filter(Boolean)
    .join("\n\n");
}

export function createDocumentAttachmentSummary(files: TaskWriterFile[]) {
  const namedFiles = files
    .map((file) => file.fileName || file.url || file.base64 || file.data || "")
    .filter(Boolean);
  if (namedFiles.length === 0) return "";
  return namedFiles
    .map(
      (name, index) =>
        `--- Content from ${name} ---\nChunk 1:\n[Attached file ${index + 1}: ${name}]`
    )
    .join("\n");
}
