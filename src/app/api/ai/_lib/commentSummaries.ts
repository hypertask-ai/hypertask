import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { generateText } from "ai";

import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import {
  providerOptionsForAiModel,
  resolveAiModel,
} from "@/app/api/ai/_lib/modelProvider";
import { convertHtmlToText } from "@/app/api/ai/_lib/taskContent";
import { resolveSystemModel } from "@/app/api/ai/_lib/systemModelLadder";
import prisma from "@/lib/prisma";

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
    const systemModel = resolveSystemModel(
      "summaries",
      comment.task.project.team?.aiProviderSettings,
    );
    if (!systemModel) return null;
    const gatewayApiKey = await getTeamGatewayApiKey({
      trustedTeamId: comment.task.project.teamId,
    });
    const model = resolveAiModel("gateway", systemModel.model, gatewayApiKey);
    configureAiModelUsage(model, {
      userId: comment.creatorId ?? comment.task.userId,
      teamId: comment.task.project.teamId,
      projectId: comment.task.projectId,
      taskId: comment.task.id,
      agentId: comment.agentId,
      provider: systemModel.provider,
      feature: "summary",
    });
    const result = await generateText({
      model,
      instructions: renderPrompt("comment-summaries-instructions-1", (targetLines === 1
    ? "Output exactly one plain single sentence. Do not add a bullet marker."
    : `Output exactly ${targetLines} markdown bullets using "- ".`)),
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
