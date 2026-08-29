import { NextRequest, NextResponse } from "next/server";
import { htmlToText } from "@/app/api/ai/_lib/currentTaskContext";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { isUneditedHyperAiComment } from "@/lib/ai/hyperAiConfirmation";
import {
  createTaskWriterUserContent,
  errorMessage,
  getCurrentUserFromCookies,
  HOUSE_OUTPUT_STYLE,
  retrieveTaskWriterContext,
  selectTaskWriterModel,
} from "@/app/api/ai/_lib/editorAi";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";
import { markAiDetailAnchors } from "@/utils/controllers/comments/ticketRefLinker";
import {
  loadCurrentTaskContext,
  loadCurrentTaskImages,
  resolveAiUsageTaskId,
} from "@/app/api/ai/_lib/currentTaskContext";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import { resolveSkills } from "@/app/api/ai/_lib/skills";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import {
  aiModelOptions,
  getAiModelDefinition,
  resolveAiModelMention,
} from "@/lib/aiModelOptions";
import { getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { verifyCookieIdentity } from "@/lib/auth/cookieIdentity";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { validateMcpAuth } from "@/lib/mcp/auth";
import {
  createHyperAiTools,
  HYPER_AI_TOOL_COUNT,
} from "@/app/api/ai/_lib/hyperAiTools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attachmentSchema = z
  .object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
  })
  .passthrough();

const byokProviderFlagSchema = z
  .object({
    provider: z.string().optional().nullable(),
    enabled: z.boolean().optional().nullable(),
    ciphertext: z.string().optional().nullable(),
  })
  .passthrough();

const hyperMentionRequestSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  taskId: z.coerce.number().int().positive(),
  text: z.string().min(1),
  sourceType: z.enum(["Description", "Comment"]).default("Description"),
  sourceCommentId: z.coerce.number().int().positive().optional(),
  user_context: z
    .object({
      id: z.coerce.number().int().optional(),
      email: z.string().optional().nullable(),
      displayName: z.string().optional().nullable(),
    })
    .nullable()
    .optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  sourceSelected: z.string().optional().default("openai"),
  modelSelected: z.string().optional().nullable(),
  modelOptionId: z.string().optional().nullable(),
  modelMentionLabel: z.string().optional().nullable(),
  images64: z.array(attachmentSchema).optional().default([]),
  pdfs64: z.array(attachmentSchema).optional().default([]),
  docx64: z.array(attachmentSchema).optional().default([]),
  byokProviderFlags: z.array(byokProviderFlagSchema).optional().default([]),
}).superRefine((body, ctx) => {
  if (body.sourceType === "Comment" && body.sourceCommentId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceCommentId"],
      message: "sourceCommentId is required for comment mentions",
    });
  }
});

export async function POST(request: NextRequest) {
  const [cookieUser, sessionUser, cookieIdentity] = await Promise.all([
    getCurrentUserFromCookies(),
    getSessionUser(request.headers),
    verifyCookieIdentity(
      request.cookies.get("nookies_user")?.value,
      request.cookies.get(SESSION_COOKIE)?.value,
    ),
  ]);
  const cookieClaimId = cookieUser?.id ? Number(cookieUser.id) : null;
  // Legacy browser sessions prove nookies_user with the signed ht_session.
  // Better Auth sessions are also valid when their server-resolved identity
  // agrees with the legacy display cookie. The JSON cookie alone never proves
  // identity, but neither path requires an Authorization header.
  const authenticatedSessionUserId =
    cookieIdentity.status === "verified"
      ? cookieIdentity.id
      : sessionUser &&
          (cookieClaimId === null || sessionUser.userId === cookieClaimId)
        ? sessionUser.userId
        : null;
  const sessionBackedUser = authenticatedSessionUserId
    ? await prisma.user.findUnique({
        where: { id: authenticatedSessionUserId },
        select: { id: true, email: true, displayName: true },
      })
    : null;
  const validSessionUser =
    sessionBackedUser &&
    (cookieClaimId === null || cookieClaimId === sessionBackedUser.id)
      ? {
          id: sessionBackedUser.id,
          email: sessionBackedUser.email,
          displayName: sessionBackedUser.displayName ?? undefined,
        }
      : null;
  const hasAuthorization = request.headers.has("Authorization");
  const bearerContext = hasAuthorization
    ? await validateMcpAuth(request)
    : null;
  // A supplied bearer remains the selected principal even when an ambient
  // browser session is present. Native agents and management keys cannot use
  // this human HyperAI entry point or inherit its user-scoped MCP token.
  const requestUser = hasAuthorization
    ? bearerContext && !bearerContext.agentId && !bearerContext.management
      ? bearerContext.user
      : null
    : validSessionUser;
  if (!requestUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsedBody = hyperMentionRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid HyperAI request" },
        { status: 400 },
      );
    }
    const body = parsedBody.data;
    const writableTask = await prisma.task.findFirst({
      where: {
        id: body.taskId,
        projectId: body.projectId,
        deletedAt: null,
        project: taskWriteAccessWhere(requestUser.id),
      },
      select: { id: true, userId: true },
    });
    if (!writableTask) {
      return NextResponse.json(
        { error: "Task not found in this project" },
        { status: 404 },
      );
    }
    const taskOwnerId = writableTask.userId ?? body.ownerId;
    if (!taskOwnerId) {
      return NextResponse.json(
        { error: "Task owner not found" },
        { status: 400 },
      );
    }
    let sourceMessageId = `description:${body.taskId}`;
    let sourceMessageText = body.text;
    let sourceMessageCreatedAt: Date | null = null;
    let sourceMessageImmutable = false;
    if (body.sourceType === "Comment") {
      const sourceComment = await prisma.comment.findFirst({
        where: {
          id: body.sourceCommentId,
          taskId: body.taskId,
          creatorId: requestUser.id,
          agentId: null,
        },
        select: { id: true, text: true, createdAt: true, agentId: true },
      });
      if (!sourceComment) {
        return NextResponse.json(
          { error: "Source comment not found or access denied" },
          { status: 403 },
        );
      }
      sourceMessageImmutable = await isUneditedHyperAiComment({
        commentId: sourceComment.id,
        userId: requestUser.id,
        taskId: body.taskId,
        agentId: sourceComment.agentId,
        text: sourceComment.text,
        createdAt: sourceComment.createdAt,
      });
      sourceMessageId = `comment:${sourceComment.id}`;
      sourceMessageText = sourceComment.text;
      sourceMessageCreatedAt = sourceComment.createdAt;
    }
    const usageTaskId = await resolveAiUsageTaskId({
      taskId: body.taskId,
      projectId: body.projectId,
      userId: requestUser.id,
    });
    if (usageTaskId === null) {
      return NextResponse.json(
        { error: "Task not found in this project" },
        { status: 400 },
      );
    }
    const teamContext = await getProjectTeamProviderContext(
      body.projectId,
      requestUser.id,
    );
    if (teamContext.projectId !== body.projectId) {
      return NextResponse.json(
        { error: "Task not found in this project" },
        { status: 404 },
      );
    }
    if (!isAiFeatureEnabled("hyperAi", teamContext.settings)) {
      return NextResponse.json(
        { error: "This AI feature is turned off for your team" },
        { status: 403 },
      );
    }
    const skillResolution = await resolveSkills(sourceMessageText, {
      userId: requestUser.id,
      projectId: body.projectId,
    });
    // A bare "@hyperai /standup" strips to an empty string. Fall back to the raw
    // text so retrieval and the model prompt are never empty; the skill body in
    // the system prompt still carries the intent.
    const promptText = skillResolution.cleanedText || sourceMessageText;
    const requestedMentionLabel = body.modelMentionLabel?.trim() || null;
    const requestedMention = resolveAiModelMention(requestedMentionLabel);
    const selectModel = (useDefault = false) => {
      const useFeatureDefault = useDefault || !requestedMention;
      return selectTaskWriterModel({
        sourceSelected: requestedMention?.modelOption.source,
        modelSelected: requestedMention?.modelOption.id,
        modelOptionId: requestedMention?.modelOption.id,
        byokProviderFlags: body.byokProviderFlags,
        projectId: body.projectId,
        userId: requestUser.id,
        agentId: bearerContext?.agentId ?? null,
        feature: "hyper-mentioned",
        aiFeature: useFeatureDefault ? "hyperAi" : undefined,
        teamContext,
      });
    };
    let mentionModelUnavailable = Boolean(
      requestedMentionLabel && !requestedMention
    );
    let selected: Awaited<ReturnType<typeof selectTaskWriterModel>>;
    try {
      selected = await selectModel();
    } catch (error) {
      if (!requestedMentionLabel) throw error;
      mentionModelUnavailable = true;
      selected = await selectModel(true);
    }
    const definitionForSelectedModel = (modelId: string) => {
      const option = aiModelOptions.find((candidate) => candidate.model === modelId);
      return option ? getAiModelDefinition(option.modelKey) : undefined;
    };
    if (
      requestedMention &&
      definitionForSelectedModel(selected.modelId)?.key !==
        requestedMention.definition.key
    ) {
      mentionModelUnavailable = true;
      selected = await selectModel(true);
    }
    const accessibleProjects = await prisma.project.findMany({
      where: {
        status: "Normal",
        ...getProjectWhere(requestUser.id),
      },
      select: { id: true },
    });
    const accessibleProjectIds = accessibleProjects.map(
      (project) => project.id
    );
    // The mention is always about the ticket it was posted on. Load that
    // ticket's own content directly so it is ALWAYS in context and clearly
    // labelled, then add accessible-board semantic results only as background. Without
    // the "THIS TICKET" anchor, a vague prompt like "summarize this ticket" fell
    // back to the project-wide search and could summarise an unrelated ticket.
    const [currentTaskContext, currentTaskImages, relatedContext] =
      await Promise.all([
        loadCurrentTaskContext([usageTaskId], requestUser.id, undefined, {
          projectId: body.projectId,
        }),
        // Images anywhere on this ticket (description + all comments), not just the
        // triggering comment's own attachments (body.images64). Fixes HyperAI being
        // blind to screenshots posted in the description or an earlier comment.
        loadCurrentTaskImages([body.taskId], requestUser.id),
        retrieveTaskWriterContext({
          projectId: body.projectId,
          projectIds:
            accessibleProjectIds.length > 0
              ? accessibleProjectIds
              : undefined,
          prompt: promptText,
          taskIds: [body.taskId],
        }),
      ]);
    const context = [
      currentTaskContext,
      relatedContext &&
        `=== OTHER PROJECT CONTEXT (may be about DIFFERENT tickets from OTHER BOARDS the user can access — use only for cross-references, never summarise these as if they were the current ticket) ===\n${relatedContext}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const requester = await prisma.user.findUnique({
      where: { id: requestUser.id },
      select: { email: true },
    });
    if (!requester) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tools = createHyperAiTools({
      user: { id: requestUser.id, email: requester.email },
      actingAgentId: bearerContext?.agentId ?? null,
      projectId: body.projectId,
      taskId: body.taskId,
      sourceMessageId,
      sourceMessageText,
      sourceMessageCreatedAt,
      sourceMessageImmutable,
    });

    const result = await generateText({
      model: selected.model,
      instructions: `You are HyperAI, an assistant inside Hypertask.
Return only a valid HTML fragment using basic tags like <p>, <ul>, <li>, <strong>, and <a>.
${HOUSE_OUTPUT_STYLE}
The user mentioned you inside one specific ticket. The context block labelled "THIS TICKET" is that ticket and is the subject of the request — answer about THIS TICKET. Treat any "OTHER PROJECT CONTEXT" only as background from this board or OTHER BOARDS the user can access; use it for cross-references and never summarise or describe a different ticket as if it were the one the user asked about.
Never claim you lack access to a board. If you cannot find something, say you could not find it.
When mentioning a ticket you already resolved from context (you know its projectId and ticket number, e.g. HTPR-1234), wrap it in <a href="/detail/project-{projectId}/{uniqueIndex}">HTPR-1234</a> rather than plain text.
You have ${HYPER_AI_TOOL_COUNT} Hypertask tools backed by the same MCP capability registry. Use them when the user asks you to inspect or change Hypertask data; do not claim a supported job is unavailable.
Every mutation is protected by cross-message confirmation. The first exact write call returns confirmation_required and changes nothing. Summarize the exact proposed write, ask the user to confirm in a later comment, and end the turn. Set confirmed=true only when the CURRENT user comment explicitly approves that earlier proposal. Never treat the same comment that requested a write as confirmation, and never alter the proposal while confirming it.
Read-only calls do not need confirmation. Default ambiguous references like "this task" or "this board" to the current task and project in the request context.
Do not include markdown fences, greetings, or sign-offs.${
        skillResolution.systemPromptAddition
          ? `\n\n${skillResolution.systemPromptAddition}`
          : ""
      }`,
      messages: [
        {
          role: "user",
          content: createTaskWriterUserContent(
            `User request:\n${promptText}\n\nHypertask context:\n${context || "(no retrieved context)"}`,
            [
              ...body.images64,
              ...body.pdfs64,
              ...body.docx64,
              // ponytail: the triggering comment's image may also appear here as a
              // URL, so the model may see it twice — harmless, and cheap under the cap.
              ...currentTaskImages,
            ]
          ),
        },
      ],
      tools,
      stopWhen: stepCountIs(12),
      abortSignal: request.signal,
      maxRetries: 2,
      providerOptions: selected.providerOptions,
      ...selected.settings,
    });
    const { text } = result;
    const executedToolNames = result.steps.flatMap((step) =>
      step.toolCalls.map((call) => call.toolName),
    );
    if (executedToolNames.length > 0) {
      console.info("[ai/hyper-mentioned] tool loop complete", {
        projectId: body.projectId,
        taskId: body.taskId,
        userId: requestUser.id,
        steps: result.steps.length,
        tools: executedToolNames,
      });
    }
    await logAiUsage({
      userId: requestUser.id,
      teamId: selected.teamId,
      projectId: body.projectId,
      taskId: usageTaskId,
      provider: selected.usageProvider,
      model: selected.modelId,
      feature: "hyper-mentioned",
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    });

    const botUserId = parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332", 10);
    const botUser = await prisma.user.findUnique({ where: { id: botUserId } });
    if (!botUser) {
      throw new Error("HyperAI user not found");
    }

    const requesterName = requestUser.displayName || "User";
    const requesterId = requestUser.id;
    const sanitizedAiHtml = sanitizeRichHtml(ensureHtmlFragment(text));
    // Linkify is enrichment only — never let it fail the comment post.
    // markAiDetailAnchors also stamps model-authored detail links so NO
    // AI-generated anchor can create a TaskRelation via extractTaskReferences.
    const aiResponse = markAiDetailAnchors(
      await linkifyTicketRefs(sanitizedAiHtml, requestUser.id).catch(
        (err) => {
          console.error("linkifyTicketRefs failed, posting unlinked:", err);
          return sanitizedAiHtml;
        }
      )
    );
    const selectedDefinition = definitionForSelectedModel(selected.modelId);
    const selectedModelLabel =
      selectedDefinition?.label ?? selected.modelId;
    const modelFooter = requestedMentionLabel
      ? `<p><em>— ${escapeHtml(selectedModelLabel)}${
          mentionModelUnavailable
            ? ` (${escapeHtml(requestedMentionLabel)} unavailable)`
            : ""
        }</em></p>`
      : "";
    const commentText =
      `<p><span data-type="mention" class="mention" data-id="${escapeHtml(requesterName)}" data-label="name-${requesterId}" uniqueindex="" projectid="">${escapeHtml(requesterName)}</span> said</p>` +
      `<blockquote>${escapeHtml(htmlToText(sourceMessageText))}</blockquote>` +
      aiResponse +
      modelFooter;

    await createCommentService({
      text: commentText,
      creatorId: botUserId,
      taskId: body.taskId,
      ownerId: taskOwnerId,
      currentUser: botUser,
      accessUserId: requestUser.id,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[ai/hyper-mentioned] error:", error);
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500 }
    );
  }
}

function ensureHtmlFragment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "<p>Sorry, I could not generate a response.</p>";
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  return `<p>${escapeHtml(trimmed)}</p>`;
}


function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
