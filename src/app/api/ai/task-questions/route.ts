import { generateText } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
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

const TASK_QUESTIONS_INSTRUCTIONS = `You predict the next move of a specific user (the VIEWER) looking at a task in Hypertask, a project management tool.

Generate the 5 prompts the viewer is most likely to want to send to their AI assistant next. The assistant executing these prompts has full access to this task, its comments, and the whole board, and can draft comments the viewer pastes or sends.

Produce EXACTLY 5 prompts in this fixed structure:
- Prompt 1-2: COMMUNICATION — each drafts the viewer's next likely message: answering a question directed at them, unblocking a named person, chasing an open decision, posting the update the thread is waiting for. Start with "Draft". If someone asked the VIEWER something still unanswered, prompt 1 drafts that reply, naming the person or topic.
- Prompt 3-5: FORWARD MOTION — checks that surface what moves this ticket forward: an open decision, an unverified claim, a missing sign-off, a risk nobody addressed. NEVER start with "Draft". Verb-first checks ("Check...", "Verify...") or blunt questions ("Is the fix live yet?").

STYLE — each prompt is a short headline, not a sentence:
- Max 7 words. Hard cap. Fragments are fine.
- Verb-first ("Draft...", "Check...", "Verify...") or a blunt question.
- No hedging: never "Should I...", "Can you...", "Would it be worth...". The prompt IS the ask.
- The assistant expands the headline from full ticket context when sent — the prompt only needs to identify the thread, not carry its detail.
- Anchor by person or topic ("Draft reply to Sarah"), never by comment position — the assistant cannot resolve "comment 3".
- Examples of the target shape: "Draft reply to Sarah's pricing question", "Check the fallback pricing patch", "Any opus-4.8 refs left?", "Is the QA blocker fixed yet?"

HARD RULES:
- Each of the 5 prompts covers a DIFFERENT open thread or topic. Never restate one thread twice.
- Every prompt MUST be anchored in ONE concrete detail of THIS ticket: a name, number, claim, artifact, or open thread. If you cannot anchor it, do not write it.
- Banned: generic templates like "What are the next steps?", "Summarize this ticket", "What's blocking this?" with no specifics.
- Banned phrasing: "Ask the assistant..." — every prompt already addresses the assistant directly.
- Never suggest drafting something the viewer already posted in their own recent comments. Their next move is what comes AFTER their last message.
- Say "this ticket" instead of this ticket's own number; other ticket/PR numbers are good anchors.
- Output STRICT JSON, nothing else: {"questions":["...","..."]}`;

type TaskComment = {
  creatorId: number | null;
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
    const result = await generateText({
      model,
      instructions: TASK_QUESTIONS_INSTRUCTIONS,
      prompt: `${viewerBlock}

TASK TITLE: ${task.title}
STATUS/SECTION: ${task.status} / ${task.section}
DESCRIPTION:
${description || "(empty)"}

COMMENTS (newest first):
${formattedComments}`,
      maxOutputTokens: 500,
      maxRetries: 2,
      providerOptions: providerOptionsForAiModel(
        model,
        "task-questions",
        gatewayTags
      ),
    });

    await logAiUsage({
      userId: viewer.id,
      teamId: task.project.teamId,
      projectId: task.projectId,
      taskId: task.id,
      provider: systemModel.provider,
      model: systemModel.model,
      feature: "task-questions",
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    });

    const json = result.text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "");
    if (!json) throw new Error("Model returned empty content");

    const generated = JSON.parse(json) as { questions?: unknown };
    const questions = Array.isArray(generated.questions)
      ? generated.questions
          .filter((question): question is string => typeof question === "string")
          .map((question) => question.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    if (questions.length === 0) {
      throw new Error("Model returned no usable questions");
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error("[ai/task-questions] failed:", error);
    return NextResponse.json({ questions: [] });
  }
}
