import { resolveAiModel as resolveLegacyAiModel } from "@/app/api/ai/_lib/modelProvider";
import { getAiDefaultModelContext, resolveAutomaticAiModel } from "@/app/api/ai/_lib/byokKeys";
import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { generateText } from "ai";

import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import {
  providerOptionsForAiModel,
  aiUsageProviderForCredential,
} from "@/app/api/ai/_lib/modelProvider";
import { convertHtmlToText } from "@/app/api/ai/_lib/taskContent";
import { resolveSystemModel } from "@/app/api/ai/_lib/systemModelLadder";
import prisma from "@/lib/prisma";
import { HTPR_7046_TLDR_OPEN_QUESTIONS_FLAG, isFeatureEnabled } from "@/lib/flags";

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
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        text: true,
        summary: true,
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

    const targetLines = getCommentSummaryTargetLines(wordCount);
    const defaultContext = typeof getAiDefaultModelContext === "function" ? await getAiDefaultModelContext({ trustedTeamId: comment.task.project.teamId, userId: comment.creatorId ?? comment.task.userId }) : { haiku55Enabled: false, byok: undefined };
    const systemModel = resolveSystemModel(
      "summaries",
      comment.task.project.team?.aiProviderSettings,
      defaultContext.haiku55Enabled,
      defaultContext,
    );
    if (!systemModel) return null;
    const gatewayApiKey = await getTeamGatewayApiKey({
      trustedTeamId: comment.task.project.teamId,
    });
    const haikuByok = systemModel.model === "anthropic/claude-haiku-5.5" ? defaultContext.byok : undefined;
    const model = defaultContext.haiku55Enabled ? resolveAutomaticAiModel(haikuByok?.provider === "claude" ? "claude" : haikuByok?.provider === "openrouter" ? "openrouter" : "gateway", haikuByok?.provider === "claude" ? "claude-haiku-5-5" : systemModel.model, haikuByok?.credential ?? gatewayApiKey, { haiku55Enabled: defaultContext.haiku55Enabled, lookup: { trustedTeamId: comment.task.project.teamId, projectId: comment.task.projectId, userId: comment.creatorId ?? comment.task.userId }, feature: "summary" }) : resolveLegacyAiModel("gateway", systemModel.model, gatewayApiKey);
    configureAiModelUsage(model, {
      userId: comment.creatorId ?? comment.task.userId,
      teamId: comment.task.project.teamId,
      projectId: comment.task.projectId,
      taskId: comment.task.id,
      agentId: comment.agentId,
      provider: haikuByok ? aiUsageProviderForCredential(haikuByok.provider, haikuByok.credential) : systemModel.provider,
      feature: "summary",
    });
    const openQuestionRules = await isFeatureEnabled(HTPR_7046_TLDR_OPEN_QUESTIONS_FLAG, comment.creatorId ?? comment.task.userId);
    const result = await generateText({
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
      data: { summary },
    });

    return stored.count > 0 ? summary : null;
  } catch (error) {
    console.error("[commentSummaries] failed to generate summary:", error);
    return null;
  }
}
