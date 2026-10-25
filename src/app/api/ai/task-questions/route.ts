import { downloadWithoutBrotli } from "@/lib/net/downloadWithoutBrotli";
import { warnIfAllowanceRefused } from "@/app/api/ai/_lib/allowanceRefusal";
import { HTPR_7716_ALLOWANCE_FALLBACKS_FLAG } from "@/lib/flags/definitions/htpr-7716-allowance-fallbacks";
import { taskWriterSkillsSchema, MAX_SKILL_INPUT_LENGTH } from "@/lib/ai/taskWriterSkills";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import { resolveAiModel as resolveLegacyAiModel } from "@/app/api/ai/_lib/modelProvider";
import { getAiDefaultModelContext, keyOnlySideCallModel, resolveAutomaticAiModel } from "@/app/api/ai/_lib/byokKeys";
import { reportError } from "@/lib/errors/reportError";
import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { cachedInstructionsForUser } from "@/app/api/ai/_lib/promptCache";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { HTPR_7534_WRITING_QUESTIONS_FLAG, HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG, HTPR_7979_ACTION_CHIPS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import {
  providerOptionsForAiModel,
  aiUsageProviderForCredential,
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
const MAX_ORIGINAL_NOTE = 2000;
const MAX_BOARD_RULES = 2000;
const MAX_ACTION_CHIPS = 3;

const taskQuestionsRequestSchema = z.object({
  taskId: z.coerce.number().int().positive(),
  kind: z.enum(["next-move", "new-ticket"]).default("next-move"),
  originalNote: z.string().transform((value) => value.slice(0, MAX_ORIGINAL_NOTE)).optional(),
  skillFollowup: z.object({
    skills: taskWriterSkillsSchema,
    originalInput: z.string().max(MAX_SKILL_INPUT_LENGTH),
  }).optional(),
});

const TASK_QUESTIONS_INSTRUCTIONS = renderPrompt("task-questions-context-1");
const NEW_TICKET_QUESTIONS_INSTRUCTIONS = renderPrompt("task-questions-new-ticket-1");
const WRITING_QUESTIONS_INSTRUCTIONS = renderPrompt("task-questions-writing-1");
const ACTION_CHIPS_INSTRUCTIONS = renderPrompt("task-questions-action-chips-1");
const SKILL_FOLLOWUP_INSTRUCTIONS = renderPrompt("task-questions-skill-followup-1");
const taskQuestionsOutputSchema = z.object({
  questions: z.array(z.string()),
});

const skillFollowupOutputSchema = taskQuestionsOutputSchema.extend({
  followup: z.string().min(1).max(12000),
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
  const flagViewer = await getCurrentUserFromCookies();
  if (flagViewer?.id && await isFeatureEnabled(HTPR_7979_ACTION_CHIPS_FLAG, flagViewer.id)) {
    return withAgentScopeRequest(request, () => taskQuestions(request, true));
  }
  return withAgentScopeRequest(request, () => taskQuestions(request, false));
}

async function taskQuestions(request: NextRequest, actionChipsFlag: boolean) {
  const viewer = await getCurrentUserFromCookies();
  if (!viewer?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actingAgentId = (await getSessionUser(request.headers))?.agentId;

  const parsedBody = taskQuestionsRequestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let allowanceFallbacksEnabled = false;
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: parsedBody.data.taskId,
        project: {
          ...getProjectWhere(viewer.id),
          AND: [getProjectWhere(viewer.id, actingAgentId)],
        },
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
            ai_custom_instructions: { select: { customInstruction: true }, take: 1 },
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
    let skillContext: string | undefined;
    const followupRequest = parsedBody.data.kind === "new-ticket" ? parsedBody.data.skillFollowup : undefined;
    if (followupRequest && await isFeatureEnabled(HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG, viewer.id)) {
      const { resolveSkills } = await import("@/app/api/ai/_lib/skills");
      const resolved = await resolveSkills(followupRequest.skills.map(({ slug }) => `/${slug}`).join(" "), {
        userId: viewer.id, projectId: task.projectId,
      });
      const matchesWriter = resolved.skills.length === followupRequest.skills.length && resolved.skills.every((skill, index) => {
        const written = followupRequest.skills[index];
        return skill.id === written.id && skill.slug === written.slug && skill.updatedAt.toISOString() === written.updatedAt;
      });
      if (!matchesWriter) return NextResponse.json({ questions: [] });
      const cleaned = await resolveSkills(followupRequest.originalInput, { userId: viewer.id, projectId: task.projectId }, async () => resolved.skills);
      skillContext = JSON.stringify({
        skills: resolved.skills.map(({ slug, name, body }) => ({ slug, name, body })),
        originalInput: cleaned.cleanedText,
        ticket: { title: task.title, column: task.section, description },
      });
    }

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

    if (!skillContext && !description && comments.length === 0) {
      return NextResponse.json({ questions: [] });
    }

    let viewerLastComment = comments.find(
      (comment) => comment.creatorId === viewer.id
    );
    if (!viewerLastComment) {
      const olderViewerComments = await prisma.comment.findMany({
        where: {
          taskId: task.id,
          creatorId: viewer.id,
          task: { project: getProjectWhere(viewer.id, actingAgentId) },
        },
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
            task: { project: getProjectWhere(viewer.id, actingAgentId) },
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
    allowanceFallbacksEnabled = await isFeatureEnabled(HTPR_7716_ALLOWANCE_FALLBACKS_FLAG, viewer.id);
    const defaultContext = typeof getAiDefaultModelContext === "function" ? await getAiDefaultModelContext({ trustedTeamId: task.project.teamId, userId: viewer.id }) : { haiku55Enabled: false, byok: undefined };
    const systemModel = resolveSystemModel(
      "questionSuggestions",
      task.project.team?.aiProviderSettings,
      defaultContext.haiku55Enabled,
      defaultContext,
    );
    if (!systemModel) {
      return NextResponse.json({ questions: [] });
    }
    const funded = typeof keyOnlySideCallModel === "function"
      ? await keyOnlySideCallModel(
        { trustedTeamId: task.project.teamId, projectId: task.projectId, userId: viewer.id },
        systemModel.provider,
      )
      : null;
    const gatewayApiKey = funded ? undefined : await getTeamGatewayApiKey({
      trustedTeamId: task.project.teamId,
    });
    const gatewayTags: AiGatewayTags = {
      teamId: task.project.teamId,
      projectId: task.projectId,
    };
    const haikuByok = systemModel.model === "anthropic/claude-haiku-5.5" ? defaultContext.byok : undefined;
    const model = funded?.model ?? (defaultContext.haiku55Enabled ? resolveAutomaticAiModel(haikuByok?.provider === "claude" ? "claude" : haikuByok?.provider === "openrouter" ? "openrouter" : "gateway", haikuByok?.provider === "claude" ? "claude-haiku-5-5" : systemModel.model, haikuByok?.credential ?? gatewayApiKey, { haiku55Enabled: defaultContext.haiku55Enabled, lookup: { trustedTeamId: task.project.teamId, projectId: task.projectId, userId: viewer.id }, feature: "task-questions" }) : resolveLegacyAiModel("gateway", systemModel.model, gatewayApiKey));
    configureAiModelUsage(model, {
      userId: viewer.id,
      teamId: task.project.teamId,
      projectId: task.projectId,
      taskId: task.id,
      provider: funded?.usageProvider ?? (haikuByok ? aiUsageProviderForCredential(haikuByok.provider, haikuByok.credential) : systemModel.provider),
      feature: "task-questions",
      reasoningFeature: "suggested-questions",
    });
    const newTicket = parsedBody.data.kind === "new-ticket";
    const actionChips = newTicket && !skillContext && actionChipsFlag;
    const writingQuestions = newTicket && !actionChips && await isFeatureEnabled(HTPR_7534_WRITING_QUESTIONS_FLAG, viewer.id);
    const boardRules = (task.project.ai_custom_instructions?.[0]?.customInstruction ?? "").trim().slice(0, MAX_BOARD_RULES);
    const result = await generateText({
      experimental_download: downloadWithoutBrotli,
      model,
      instructions: await cachedInstructionsForUser(viewer.id, { modelId: systemModel.model, fixed: skillContext ? SKILL_FOLLOWUP_INSTRUCTIONS : actionChips ? ACTION_CHIPS_INSTRUCTIONS : writingQuestions ? WRITING_QUESTIONS_INSTRUCTIONS : newTicket ? NEW_TICKET_QUESTIONS_INSTRUCTIONS : TASK_QUESTIONS_INSTRUCTIONS }),
      prompt: skillContext
        ? renderPrompt("task-questions-skill-followup-prompt-1", (skillContext))
        : actionChips
        ? renderPrompt("task-questions-action-chips-prompt-1", (task.title), (task.section), (description || "(empty)"), (parsedBody.data.originalNote?.trim() || "(not provided)"), (boardRules || "(none)"))
        : newTicket
        ? renderPrompt("task-questions-new-ticket-prompt-1", (task.title), (task.section), (description || "(empty)"))
        : renderPrompt("task-questions-prompt-2", (viewerBlock), (task.title), (task.status), (task.section), (description || "(empty)"), (formattedComments)),
      output: Output.object({ schema: skillContext ? skillFollowupOutputSchema : taskQuestionsOutputSchema }),
      maxOutputTokens: skillContext ? 1800 : 500,
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
      .slice(0, newTicket ? 4 : 5)
      .slice(0, actionChips ? MAX_ACTION_CHIPS : undefined);
    const followup = skillContext && "followup" in result.output && typeof result.output.followup === "string"
      ? result.output.followup.trim() : undefined;
    return NextResponse.json({ questions, ...(followup ? { followup } : {}) });
  } catch (error) {
    if (error instanceof Error && error.name === "TeamKeyOnlyRefusal") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (allowanceFallbacksEnabled && warnIfAllowanceRefused(error, "ai/task-questions")) {
      return NextResponse.json({ questions: [] });
    }
    if (NoOutputGeneratedError.isInstance(error) ||
      (NoObjectGeneratedError.isInstance(error) && !error.text?.trim())) {
      return NextResponse.json({ questions: [] });
    }
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
