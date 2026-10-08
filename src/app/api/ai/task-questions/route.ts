import { haiku55ModelEnabled } from "@/app/api/ai/_lib/planGate";
import { reportError } from "@/lib/errors/reportError";
import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { generateText, Output } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import {
  providerOptionsForAiModel,
  resolveAiModel,
  type AiGatewayTags,
} from "@/app/api/ai/_lib/modelProvider";
import {
  convertHtmlToText,
  isSessionNoise,
} from "@/app/api/ai/_lib/taskContent";
import { resolveSystemModel } from "@/app/api/ai/_lib/systemModelLadder";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COMMENTS = 30;

const taskQuestionsRequestSchema = z.object({
  taskId: z.coerce.number().int().positive(),
});

const TASK_QUESTIONS_INSTRUCTIONS = renderPrompt("task-questions-context-1");
// HTPR-6953: structured output, so a stray quote in a question can no longer
// break a hand-rolled JSON.parse of the model text.
const taskQuestionsOutputSchema = z.object({
  questions: z.array(z.string()),
});

type TaskComment = {
  creatorId: number | null;
  agentDisplayName: string | null;
  agent: { displayName: string } | null;
  creator: { displayName: string | null; email: string | null } | null;
  createdAt: Date;
  text: string;
};

export async function POST(request: NextRequest) {
  const viewer = await getCurrentUserFromCookies();
  if (!viewer?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = taskQuestionsRequestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const task = await prisma.task.findFirst({
      where: {
        id: parsedBody.data.taskId,
        project: getProjectWhere(viewer.id),
      },
      select: {
        id: true,
        userId: true,
        projectId: true,
        title: true,
        ticketNumber: true,
        section: true,
        status: true,
        project: {
          select: {
            teamId: true,
            team: { select: { aiProviderSettings: true } },
          },
        },
        description_: { select: { content: true } },
        assignees: { select: { userId: true } },
        comments: {
          orderBy: { createdAt: "desc" },
          take: MAX_COMMENTS,
          select: {
            creatorId: true,
            text: true,
            activity: true,
            createdAt: true,
            agentDisplayName: true,
            agent: { select: { displayName: true } },
            creator: { select: { displayName: true, email: true } },
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const description = convertHtmlToText(task.description_?.content ?? "");
    const comments = task.comments
      .map((comment): TaskComment | null => {
        const text = convertHtmlToText(
          comment.text || (comment.activity ? JSON.stringify(comment.activity) : "")
        );
        if (!text || isSessionNoise(text)) return null;
        return {
          creatorId: comment.creatorId,
          agentDisplayName: comment.agentDisplayName,
          agent: comment.agent,
          creator: comment.creator,
          createdAt: comment.createdAt,
          text,
        };
      })
      .filter((comment): comment is TaskComment => comment !== null);

    if (!description && comments.length === 0) {
      return NextResponse.json({ questions: [] });
    }

    let viewerLastComment = comments.find(
      (comment) => comment.creatorId === viewer.id
    );
    if (!viewerLastComment) {
      const olderViewerComments = await prisma.comment.findMany({
        where: { taskId: task.id, creatorId: viewer.id },
        orderBy: { createdAt: "desc" },
        take: MAX_COMMENTS,
        select: {
          creatorId: true,
          text: true,
          activity: true,
          createdAt: true,
          agentDisplayName: true,
          agent: { select: { displayName: true } },
          creator: { select: { displayName: true, email: true } },
        },
      });
      viewerLastComment = olderViewerComments
        .map((comment): TaskComment | null => {
          const text = convertHtmlToText(
            comment.text ||
              (comment.activity ? JSON.stringify(comment.activity) : "")
          );
          if (!text || isSessionNoise(text)) return null;
          return { ...comment, text };
        })
        .find((comment): comment is TaskComment => comment !== null);
    }
    const newerCommentCount = viewerLastComment
      ? await prisma.comment.count({
          where: {
            taskId: task.id,
            createdAt: { gt: viewerLastComment.createdAt },
          },
        })
      : 0;
    const viewerBlock = [
      "VIEWER:",
      `Name: ${viewer.displayName || viewer.email || `User ${viewer.id}`}`,
      `Created this ticket: ${task.userId === viewer.id ? "yes" : "no"}`,
      `Assignee: ${
        task.assignees.some((assignee) => assignee.userId === viewer.id)
          ? "yes"
          : "no"
      }`,
      viewerLastComment
        ? `Last comment: ${viewerLastComment.text.slice(0, 200)} (${viewerLastComment.createdAt.toISOString()})`
        : "Last comment: none",
      `Comments newer than the viewer's last comment: ${newerCommentCount}`,
    ].join("\n");
    const formattedComments = comments.length
      ? comments
          .map((comment, index) => {
            const creator =
              comment.agent?.displayName ||
              comment.agentDisplayName ||
              comment.creator?.displayName ||
              comment.creator?.email ||
              "Unknown";
            return `[${index + 1}] ${creator} (${comment.createdAt.toISOString()}):\n${comment.text.slice(0, 800)}`;
          })
          .join("\n\n")
      : "(no comments)";
    const systemModel = resolveSystemModel(
      "questionSuggestions",
      task.project.team?.aiProviderSettings,
    await haiku55ModelEnabled(viewer.id),
    );
    if (!systemModel) {
      return NextResponse.json({ questions: [] });
    }
    const gatewayApiKey = await getTeamGatewayApiKey({
      trustedTeamId: task.project.teamId,
    });
    const gatewayTags: AiGatewayTags = {
      teamId: task.project.teamId,
      projectId: task.projectId,
    };
    const model = resolveAiModel("gateway", systemModel.model, gatewayApiKey);
    configureAiModelUsage(model, {
      userId: viewer.id,
      teamId: task.project.teamId,
      projectId: task.projectId,
      taskId: task.id,
      provider: systemModel.provider,
      feature: "task-questions",
    });
    const result = await generateText({
      model,
      instructions: TASK_QUESTIONS_INSTRUCTIONS,
      prompt: renderPrompt("task-questions-prompt-2", (viewerBlock), (task.title), (task.status), (task.section), (description || "(empty)"), (formattedComments)),
      output: Output.object({ schema: taskQuestionsOutputSchema }),
      maxOutputTokens: 500,
      maxRetries: 2,
      providerOptions: providerOptionsForAiModel(
        model,
        "task-questions",
        gatewayTags
      ),
    });

    const questions = result.output.questions
      .map((question) => question.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (questions.length === 0) {
      throw new Error("Model returned no usable questions");
    }

    return NextResponse.json({ questions });
  } catch (error) {
    await reportError({
      message: error instanceof Error ? error.message : "AI request failed",
      stack: error instanceof Error ? error.stack : undefined,
      url: "/api/ai/task-questions",
      source: "handled",
      extra: { stage: "empty-questions-fallback" },
    });
    console.error("[ai/task-questions] failed:", error);
    return NextResponse.json({ questions: [] });
  }
}
