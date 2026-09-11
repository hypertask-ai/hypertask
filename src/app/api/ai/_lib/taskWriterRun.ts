/**
 * @fileoverview
 * Shared AI Task Writer / Write with AI harness.
 *
 * Everything between "here is a prompt" and "call the model" lives here so the
 * browser route (SSE, src/app/api/ai/task-writer/route.ts) and the CLI route
 * (JSON, src/app/api/mcp/ai/task-writer/route.ts) produce identical output for
 * the same input: same feature gate, same model selection, same /skill
 * resolution, same retrieved context, same prompt parts.
 */

import { z } from "zod";

import {
  createDocumentAttachmentSummary,
  createTaskWriterPromptParts,
  createTaskWriterUserContent,
  extractImgSrcs,
  retrieveTaskWriterContext,
  selectTaskWriterModel,
  TASK_AUTHORING_STYLE,
} from "@/app/api/ai/_lib/editorAi";
import {
  loadCurrentTaskContext,
  resolveAiUsageTaskId,
} from "@/app/api/ai/_lib/currentTaskContext";
import {
  createTaskWriterSystemPromptTemplate,
  formatTaskWriterRetrievedContext,
} from "@/app/api/ai/_lib/taskWriterPrompt";
import {
  buildTaskWriterRetrievalQuery,
  formatBoardVocabulary,
  formatRelatedTicketCandidates,
  formatStyleExamples,
  HTPR_6363_TASK_WRITER_RESEARCH_FLAG,
  TASK_WRITER_BOARD_RESEARCH_RULES,
  TASK_WRITER_RELATED_CANDIDATE_LIMIT,
  TASK_WRITER_STYLE_EXAMPLE_LIMIT,
} from "@/app/api/ai/_lib/taskWriterBoardResearch";
import { resolveSkills } from "@/app/api/ai/_lib/skills";
import { getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import {
  AUTO_TASK_DESCRIPTIONS_FLAG,
  HTPR_6157_AUTO_DESCRIPTION_FLAG,
  isFeatureEnabled,
} from "@/lib/flags";
import { isNewTaskAutoDescriptionEnabled } from "@/lib/ai/autoDescriptionSuggestion";
import { doneColumnTitles } from "@/lib/doneColumns";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { BOARD_TEMPLATE_LIMIT } from "@/app/api/ai/_lib/boardTemplateContext";
import { searchTasks } from "@/utils/controllers/turbopuffer/turbopufferHelper";

const byokProviderFlagSchema = z
  .object({
    provider: z.string().optional().nullable(),
    enabled: z.boolean().optional().nullable(),
    ciphertext: z.string().optional().nullable(),
  })
  .passthrough();

const taskWriterFileSchema = z
  .object({
    fileName: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
    base64: z.string().optional().nullable(),
    data: z.string().optional().nullable(),
    mimeType: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
  })
  .passthrough();

export const taskWriterRequestSchema = z.object({
  projectId: z.coerce.number().int(),
  teamId: z.unknown().optional(),
  PROMPT: z.string().optional().default(""),
  customInstructions: z.string().optional().default(""),
  sourceSelected: z.string().optional().default("openai"),
  modelSelected: z.string().nullable().optional(),
  modelOptionId: z.string().nullable().optional(),
  aiMode: z.string().optional().default("AiTaskWriter"),
  images64: z.array(taskWriterFileSchema).optional().default([]),
  pdfs64: z.array(taskWriterFileSchema).optional().default([]),
  docx64: z.array(taskWriterFileSchema).optional().default([]),
  enableWebSearch: z.boolean().optional().default(false),
  webSearchQuery: z.string().optional().default(""),
  taskIds: z.array(z.coerce.number().int()).optional().default([]),
  taskDescription: z.string().optional().default(""),
  taskTitle: z.string().optional().default(""),
  /** User-authored briefs only; used for board search when research is on. */
  userRetrievalTexts: z.array(z.string()).optional().default([]),
  byokProviderFlags: z.array(byokProviderFlagSchema).optional().default([]),
  requestKind: z.enum(["manual", "auto-description"]).optional().default("manual"),
});

export type TaskWriterRequest = z.infer<typeof taskWriterRequestSchema>;

/** Thrown when the team has switched this AI feature off. Callers map it to 403. */
export class AiFeatureDisabledError extends Error {
  constructor() {
    super("This AI feature is turned off for your team");
    this.name = "AiFeatureDisabledError";
  }
}

/** Thrown when automatic drafting was disabled in the caller's preferences. */
export class AutoDescriptionSuggestionsDisabledError extends Error {
  constructor() {
    super("Automatic description suggestions are turned off");
    this.name = "AutoDescriptionSuggestionsDisabledError";
  }
}

/** Thrown when the caller cannot reach the project they asked to write for. */
export class ProjectAccessError extends Error {
  constructor() {
    super("Project not found or access denied");
    this.name = "ProjectAccessError";
  }
}

export function missingRequiredFields(body: TaskWriterRequest) {
  return !body.projectId || !body.PROMPT;
}

/**
 * Can this caller read this board? Owner or member, and for an agent-bound MCP
 * token the agent's own membership, not its owner's broader access.
 */
export function projectAccessWhere(userId: number, agentId?: string | null) {
  return projectContentAccessWhere(userId, agentId);
}

/**
 * Resolve the feature gate, model, skills and context for one task-writer run.
 * Returns everything `streamText`/`generateText` needs, so both callers only
 * differ in how they deliver the model output.
 */
export async function prepareTaskWriterRun(
  body: TaskWriterRequest,
  userId: number,
  agentId?: string | null
) {
  // The retrieval below searches by projectId alone, so membership has to be
  // proven here. getProjectTeamProviderContext does not: it returns an empty
  // context for an unreachable project, which reads as "no AI settings" and
  // sails through the feature gate. Without this check any bearer token could
  // pull another team's tasks and comments into the prompt by guessing an id.
  //
  // Deliberately NOT getProjectWhere: that helper also requires teamId != null,
  // which is a listing rule, not an authorization rule. A third of all boards
  // are teamless, and their owners have always been able to run the AI writer
  // on them.
  const project = await prisma.project.findFirst({
    where: { id: body.projectId, ...projectAccessWhere(userId, agentId) },
    select: { id: true },
  });
  if (!project) throw new ProjectAccessError();

  if (body.requestKind === "auto-description") {
    if (!isNewTaskAutoDescriptionEnabled()) {
      throw new AutoDescriptionSuggestionsDisabledError();
    }
    if (!(await isFeatureEnabled(HTPR_6157_AUTO_DESCRIPTION_FLAG, userId))) {
      throw new AutoDescriptionSuggestionsDisabledError();
    }
    // HTPR-6177: automatic drafting shipped before it was ready, so it stays
    // behind an owner-only flag. Only this branch is gated: the manual task
    // writer predates it and must keep working for everyone.
    if (!(await isFeatureEnabled(AUTO_TASK_DESCRIPTIONS_FLAG, userId))) {
      throw new AutoDescriptionSuggestionsDisabledError();
    }
    const preference = await prisma.userSetting.findUnique({
      where: { userId },
      select: { autoDescriptionSuggestions: true },
    });
    if (preference?.autoDescriptionSuggestions === false) {
      throw new AutoDescriptionSuggestionsDisabledError();
    }
  }

  const aiFeature =
    body.aiMode === "AiTaskWriter" ? "taskWriter" : "writeWithAi";
  const teamContext = await getProjectTeamProviderContext(
    body.projectId,
    userId
  );
  if (!isAiFeatureEnabled(aiFeature, teamContext.settings)) {
    throw new AiFeatureDisabledError();
  }

  const selected = await selectTaskWriterModel({
    sourceSelected: body.sourceSelected,
    modelSelected: body.modelSelected,
    modelOptionId: body.modelOptionId,
    byokProviderFlags: body.byokProviderFlags,
    projectId: body.projectId,
    userId,
    feature: "task-writer",
    aiFeature,
    teamContext,
  });
  // Bring AI-chat's /skill invocation to the task writer: a prompt like
  // "/minimalist-review draft this" strips the token and appends the board
  // skill's body to the instructions. Same resolver chat/hyper-mentioned use.
  const skillResolution = await resolveSkills(body.PROMPT, {
    userId,
    projectId: body.projectId,
  });
  // "/foo" alone strips to empty; fall back to the raw prompt so retrieval and
  // the model query are never blank (the skill body still carries the intent).
  const effectivePrompt = skillResolution.cleanedText || body.PROMPT;
  const boardResearchEnabled = await isFeatureEnabled(
    HTPR_6363_TASK_WRITER_RESEARCH_FLAG,
    userId
  );
  // Search uses user-authored text only when research is on. The model still
  // receives the full conversation prompt via body.PROMPT / effectivePrompt.
  const retrievalQuery = boardResearchEnabled
    ? buildTaskWriterRetrievalQuery({
        prompt: effectivePrompt,
        userRetrievalTexts: body.userRetrievalTexts,
      })
    : effectivePrompt;
  const primaryTaskIds = body.taskIds.slice(0, 1);
  const relatedTaskIds = body.taskIds.slice(1);
  const [
    currentTaskContext,
    relatedTaskContext,
    semanticContext,
    relatedCandidates,
    styleExamples,
    boardVocabulary,
    uploadedDocumentContext,
    boardTemplates,
    usageTaskId,
  ] = await Promise.all([
    // Load the referenced/current tickets in full so the writer always sees
    // them, instead of relying on the semantic search to surface them.
    loadCurrentTaskContext(primaryTaskIds, userId, agentId, {
      projectId: body.projectId,
    }),
    loadCurrentTaskContext(relatedTaskIds, userId, agentId, {
      role: "related",
      projectId: body.projectId,
    }),
    retrieveTaskWriterContext({
      projectId: body.projectId,
      prompt: retrievalQuery,
      aiMode: body.aiMode,
      taskIds: body.taskIds,
      reserveCommentBudget: boardResearchEnabled,
    }),
    boardResearchEnabled
      ? searchTasks({
          searchQuery: retrievalQuery,
          projectIds: [body.projectId],
          // Over-fetch so excluding the open ticket still leaves up to 8 peers.
          topK: TASK_WRITER_RELATED_CANDIDATE_LIMIT + body.taskIds.length + 5,
        }).then((rows) => {
          const loaded = new Set(body.taskIds.map(String));
          return formatRelatedTicketCandidates(
            rows
              .filter((row) => !loaded.has(row.id))
              .slice(0, TASK_WRITER_RELATED_CANDIDATE_LIMIT)
          );
        })
      : Promise.resolve(""),
    boardResearchEnabled
      ? loadTaskWriterStyleExamples(body.projectId)
      : Promise.resolve(""),
    boardResearchEnabled
      ? loadTaskWriterBoardVocabulary(body.projectId)
      : Promise.resolve(""),
    Promise.resolve(
      createDocumentAttachmentSummary([...body.pdfs64, ...body.docx64])
    ),
    prisma.taskTemplate.findMany({
      where: { projectId: body.projectId },
      orderBy: { updatedAt: "desc" },
      take: BOARD_TEMPLATE_LIMIT,
      select: { name: true, title: true, descriptionHtml: true },
    }),
    resolveAiUsageTaskId({
      taskId: primaryTaskIds[0],
      projectId: body.projectId,
      userId,
      agentId,
    }),
  ]);
  const retrievedContext = formatTaskWriterRetrievedContext({
    currentTaskContext,
    relatedContext: [relatedTaskContext, semanticContext]
      .filter(Boolean)
      .join("\n\n"),
    relatedCandidates,
    styleExamples,
    boardVocabulary,
  });
  const { instructions: baseInstructions, input } = createTaskWriterPromptParts({
    aiMode: body.aiMode,
    customInstructions: body.customInstructions,
    boardTemplates,
    modelSelected: selected.modelId,
    taskIds: body.taskIds,
    taskDescription: body.taskDescription,
    taskTitle: body.taskTitle,
    retrievedContext,
    uploadedDocumentContext,
    input: effectivePrompt,
  });
  const researchInstructions =
    boardResearchEnabled && body.aiMode === "AiTaskWriter"
      ? createTaskWriterSystemPromptTemplate(
          `${TASK_AUTHORING_STYLE}\n\n${TASK_WRITER_BOARD_RESEARCH_RULES}`
        )
      : null;
  const instructions = skillResolution.systemPromptAddition
    ? `${researchInstructions ?? baseInstructions}\n\n${skillResolution.systemPromptAddition}`
    : researchInstructions ?? baseInstructions;
  const files = [...body.images64, ...body.pdfs64, ...body.docx64];
  const messages = [
    {
      role: "user" as const,
      content: createTaskWriterUserContent(input, files),
    },
  ];
  // Browser task-writer descriptions carry placeholders; API clients may still
  // send raw media. In either case, reject image sources absent from the request.
  const allowedImgSrcs =
    body.aiMode === "AiTaskWriter" ? extractImgSrcs(body.taskDescription) : null;

  return {
    aiFeature,
    selected,
    instructions,
    messages,
    allowedImgSrcs,
    skills: skillResolution.skills,
    usageTaskId,
  };
}

async function loadTaskWriterBoardVocabulary(projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: {
      title: true,
      description: true,
      labels: { select: { value: true } },
      section: {
        where: { deleted: false },
        select: { section_title: true },
        orderBy: { ranking: "asc" },
      },
    },
  });
  if (!project) return "";
  return formatBoardVocabulary({
    projectTitle: project.title,
    projectDescription: project.description,
    sectionTitles: project.section.map((row) => row.section_title),
    labelNames: project.labels
      .map((row) => row.value)
      .filter((value): value is string => Boolean(value)),
  });
}

async function loadTaskWriterStyleExamples(projectId: number) {
  const sections = await prisma.section.findMany({
    where: { projectId, deleted: false },
    select: { section_title: true, isDone: true },
  });
  const doneTitleSet = doneColumnTitles(sections);
  const doneSectionTitles = sections
    .filter((section) => doneTitleSet.has(section.section_title.trim().toLowerCase()))
    .map((section) => section.section_title);
  if (doneSectionTitles.length === 0) return "";

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      status: "Normal",
      section: { in: doneSectionTitles },
    },
    orderBy: { updatedAt: "desc" },
    take: TASK_WRITER_STYLE_EXAMPLE_LIMIT,
    select: {
      projectId: true,
      uniqueIndex: true,
      ticketNumber: true,
      title: true,
      description: true,
      section: true,
    },
  });

  return formatStyleExamples(
    tasks.map((task) => ({
      projectId: task.projectId,
      uniqueIndex: task.uniqueIndex,
      ticketNumber: task.ticketNumber,
      title: task.title,
      descriptionText: task.description,
      section: task.section,
    }))
  );
}
