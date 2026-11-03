import { createHash } from "node:crypto";
import { downloadWithoutBrotli } from "@/lib/net/downloadWithoutBrotli";
import { warnIfAllowanceRefused } from "@/app/api/ai/_lib/allowanceRefusal";
import { HTPR_7716_ALLOWANCE_FALLBACKS_FLAG } from "@/lib/flags/definitions/htpr-7716-allowance-fallbacks";
import { resolveAiModel as resolveLegacyAiModel } from "@/app/api/ai/_lib/modelProvider";
import { getAiDefaultModelContext, resolveAutomaticAiModel } from "@/app/api/ai/_lib/byokKeys";
import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { generateText } from "ai";

import { getTeamGatewayApiKey, keyOnlySideCallModel } from "@/app/api/ai/_lib/byokKeys";
import {
  providerOptionsForAiModel,
  aiUsageProviderForCredential,
} from "@/app/api/ai/_lib/modelProvider";
import { convertHtmlToText } from "@/app/api/ai/_lib/taskContent";
import { resolveSystemModel } from "@/app/api/ai/_lib/systemModelLadder";
import prisma from "@/lib/prisma";
import {
  HTPR_7046_TLDR_OPEN_QUESTIONS_FLAG,
  HTPR_7728_COMMENT_SUMMARY_REFUSAL_FLAG,
  HTPR_7858_COMMENT_SUMMARY_REUSE_FLAG,
  isFeatureEnabled,
} from "@/lib/flags";
import { findSharedAiAllowanceError } from "@/app/api/ai/_lib/allowanceError";

export const OPEN_QUESTION_SUMMARY_RULES = `
- Keep open questions open: a question the comment asks but does not answer stays a question in the TL;DR, for example "Open: what evidence would show the check passed?". Never answer it.
- State only what the comment states. Never add an answer, decision, owner, date, or fact the comment did not state.`;

export function applyOpenQuestionSummaryRules(instructions: string, enabled: boolean) {
  return enabled ? `${instructions}${OPEN_QUESTION_SUMMARY_RULES}` : instructions;
}

export function getCommentSummaryTargetLines(wordCount: number) {
  return Math.min(6, Math.max(1, Math.floor(wordCount / 120)));
}

export async function generateAndStoreCommentSummary(commentId: number) {
  let allowanceFallbacksEnabled = false;
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        text: true,
        summary: true,
        summaryTextHash: true,
        activity: true,
        creatorId: true,
        agentId: true,
        task: {
          select: {
            id: true,
            userId: true,
            projectId: true,
            project: {
              select: {
                teamId: true,
                team: { select: { aiProviderSettings: true } },
              },
            },
          },
        },
      },
    });

    if (!comment) return null;

    const text = convertHtmlToText(comment.text);
    const wordCount = text ? text.split(/\s+/).length : 0;

    if (comment.activity !== null || wordCount < 120) {
      if (comment.summary !== null) {
        await prisma.comment.updateMany({
          where: { id: comment.id, text: comment.text },
          data: { summary: null },
        });
      }
      return null;
    }

    const reuseEnabled = await isFeatureEnabled(HTPR_7858_COMMENT_SUMMARY_REUSE_FLAG, comment.creatorId ?? comment.task.userId);
    const summaryTextHash = createHash("sha256").update(comment.text).digest("hex");
    if (reuseEnabled && comment.summary && comment.summaryTextHash === summaryTextHash) {
      return comment.summary;
    }

    allowanceFallbacksEnabled = await isFeatureEnabled(HTPR_7716_ALLOWANCE_FALLBACKS_FLAG, comment.creatorId ?? comment.task.userId);
    const targetLines = getCommentSummaryTargetLines(wordCount);
    const defaultContext = typeof getAiDefaultModelContext === "function" ? await getAiDefaultModelContext({ trustedTeamId: comment.task.project.teamId, userId: comment.creatorId ?? comment.task.userId }) : { haiku55Enabled: false, byok: undefined };
    const systemModel = resolveSystemModel(
      "summaries",
      comment.task.project.team?.aiProviderSettings,
      defaultContext.haiku55Enabled,
      defaultContext,
    );
    if (!systemModel) return null;
    let funded: Awaited<ReturnType<typeof keyOnlySideCallModel>> = null;
    try {
      funded = typeof keyOnlySideCallModel === "function"
        ? await keyOnlySideCallModel(
          { trustedTeamId: comment.task.project.teamId, projectId: comment.task.projectId, userId: comment.creatorId ?? comment.task.userId },
          systemModel.provider,
        )
        : null;
    } catch (error) {
      if (error instanceof Error && error.name === "TeamKeyOnlyRefusal") {
        console.error(`[commentSummaries] ${error.message}`);
        return null;
      }
      throw error;
    }
    const gatewayApiKey = funded ? undefined : await getTeamGatewayApiKey({
      trustedTeamId: comment.task.project.teamId,
    });
    const haikuByok = systemModel.model === "anthropic/claude-haiku-5.5" ? defaultContext.byok : undefined;
    const model = funded?.model ?? (defaultContext.haiku55Enabled ? resolveAutomaticAiModel(haikuByok?.provider === "claude" ? "claude" : haikuByok?.provider === "openrouter" ? "openrouter" : "gateway", haikuByok?.provider === "claude" ? "claude-haiku-5-5" : systemModel.model, haikuByok?.credential ?? gatewayApiKey, { haiku55Enabled: defaultContext.haiku55Enabled, lookup: { trustedTeamId: comment.task.project.teamId, projectId: comment.task.projectId, userId: comment.creatorId ?? comment.task.userId }, feature: "summary" }) : resolveLegacyAiModel("gateway", systemModel.model, gatewayApiKey));
    configureAiModelUsage(model, {
      userId: comment.creatorId ?? comment.task.userId,
      teamId: comment.task.project.teamId,
      projectId: comment.task.projectId,
      taskId: comment.task.id,
      agentId: comment.agentId,
      provider: funded?.usageProvider ?? (haikuByok ? aiUsageProviderForCredential(haikuByok.provider, haikuByok.credential) : systemModel.provider),
      feature: "summary",
      reasoningFeature: "tldr",
    });
    const openQuestionRules = await isFeatureEnabled(HTPR_7046_TLDR_OPEN_QUESTIONS_FLAG, comment.creatorId ?? comment.task.userId);
    const result = await generateText({
      experimental_download: downloadWithoutBrotli,
      model,
      instructions: applyOpenQuestionSummaryRules(renderPrompt("comment-summaries-instructions-1", (targetLines === 1
    ? "Output exactly one plain single sentence. Do not add a bullet marker."
    : `Output exactly ${targetLines} markdown bullets using "- ".`)), openQuestionRules),
      prompt: `SOURCE DATA:
<comment>
${text}
</comment>

TL;DR:`,
      maxRetries: 2,
      maxOutputTokens: targetLines * 160,
      providerOptions: providerOptionsForAiModel(model, "summary", {
        teamId: comment.task.project.teamId,
        projectId: comment.task.projectId,
        userId: comment.creatorId,
      }),
    });
    const summary = result.text.trim();

    if (!summary) return null;
    if (result.finishReason === "length") return null;

    const stored = await prisma.comment.updateMany({
      where: { id: comment.id, text: comment.text },
      data: { summary, summaryTextHash },
    });

    return stored.count > 0 ? summary : null;
  } catch (error) {
    if (allowanceFallbacksEnabled && warnIfAllowanceRefused(error, "commentSummaries")) return null;
    if (findSharedAiAllowanceError(error) && await isFeatureEnabled(HTPR_7728_COMMENT_SUMMARY_REFUSAL_FLAG, 0).catch(() => false)) {
      return null;
    }
    console.error("[commentSummaries] failed to generate summary:", error);
    return null;
  }
}
