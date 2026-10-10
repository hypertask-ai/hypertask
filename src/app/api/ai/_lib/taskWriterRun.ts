import { taskWriterDateContext, taskWriterDueDateInstructions } from "@/lib/ai/taskWriterDueDate";
import { HTPR_7054_CTRLJ_DUE_DATE_FLAG } from "@/lib/flags/keys";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { isEmptyComposeTarget } from "@/lib/ai/composeTaskTarget";
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
  TASK_WRITER_RESEARCH_REQUEST_RULE,
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
import { isFeatureEnabled, HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG, HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG, HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG, HTPR_7057_WRITER_HEADING_LANGUAGE_FLAG } from "@/lib/flags";
import { renderPrompt } from "@/lib/ai/prompts/registry";
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
  timeZone: z.string().max(64).optional(),
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
  userRetrievalTexts: z.array(z.string()).max(20).optional().default([]),
  byokProviderFlags: z.array(byokProviderFlagSchema).optional().default([]),
  existingTaskId: z.number().int().positive().optional(),
  requestKind: z.enum(["manual", "auto-description", "compose-task"]).optional().default("manual"),
});

export const tasksOutputSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    dueDate: z.string().nullish(),
  })).min(1).max(10),
});

export type TaskWriterRequest = z.infer<typeof taskWriterRequestSchema>;

/** Thrown when the team has switched this AI feature off. Callers map it to 403. */
export class AiFeatureDisabledError extends Error {
  constructor() {
    super("This AI feature is turned off for your team");
    this.name = "AiFeatureDisabledError";
  }
}

/** Thrown for legacy requests to the removed automatic description draft. */
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
  if (body.requestKind === "compose-task" &&
      !(await isFeatureEnabled(HTPR_6929_COMPOSE_TASK_WRITER_FLAG, userId))) {
    const error = new AiFeatureDisabledError();
    error.message = "Compose task writer is turned off";
    throw error;
  }

  if (body.existingTaskId != null) {
    if (body.requestKind !== "compose-task" ||
        !(await isFeatureEnabled(HTPR_6937_NEW_TASK_WINDOW_FLAG, userId))) {
      throw new AiFeatureDisabledError();
    }
    const target = await prisma.task.findFirst({
      where: { id: body.existingTaskId, projectId: body.projectId, status: "Normal", project: taskWriteAccessWhere(userId, agentId) },
      include: { description_: { select: { content: true } } },
    });
    if (!target || !isEmptyComposeTarget(target)) throw new ProjectAccessError();
  }

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

  // Older tabs can still send the removed new-task draft request. Keep it off.
  if (body.requestKind === "auto-description") {
    throw new AutoDescriptionSuggestionsDisabledError();
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
    taskWriterAgentId: agentId,
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
  const boardResearchEnabled =
    body.aiMode === "AiTaskWriter" &&
    (await isFeatureEnabled(HTPR_6363_TASK_WRITER_RESEARCH_FLAG, userId));
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
          topK: Math.min(
            TASK_WRITER_RELATED_CANDIDATE_LIMIT + 8,
            TASK_WRITER_RELATED_CANDIDATE_LIMIT +
              Math.min(body.taskIds.length, 8) +
              5
          ),
        })
          .then((rows) => {
            const loaded = new Set(body.taskIds.map(String));
            return formatRelatedTicketCandidates(
              rows
                .filter((row) => !loaded.has(row.id))
                .slice(0, TASK_WRITER_RELATED_CANDIDATE_LIMIT)
            );
          })
          .catch((error) => {
            console.error("[ai/task-writer] related candidates failed", error);
            return "<RELATED_TICKET_CANDIDATES>\nunavailable:search_failed Do not invent related tickets. Ask whether this might already exist on the board.\n</RELATED_TICKET_CANDIDATES>";
          })
      : Promise.resolve(""),
    boardResearchEnabled
      ? loadTaskWriterStyleExamples(body.projectId).catch((error) => {
          console.error("[ai/task-writer] style examples failed", error);
          return "";
        })
      : Promise.resolve(""),
    boardResearchEnabled
      ? loadTaskWriterBoardVocabulary(body.projectId).catch((error) => {
          console.error("[ai/task-writer] board vocabulary failed", error);
          return "";
        })
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
  const researchInstructions = boardResearchEnabled
      ? createTaskWriterSystemPromptTemplate(
          `${TASK_AUTHORING_STYLE}\n\n${TASK_WRITER_BOARD_RESEARCH_RULES}`
        )
      : null;
  const validateDraft = await isFeatureEnabled(HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG, userId);
  const splitTasks = body.requestKind === "compose-task" && body.aiMode === "AiTaskWriter" &&
    await isFeatureEnabled(HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG, userId);
  let instructions = skillResolution.systemPromptAddition
    ? `${researchInstructions ?? baseInstructions}\n\n${skillResolution.systemPromptAddition}`
    : researchInstructions ?? baseInstructions;
  if (splitTasks) {
    instructions += "\n\nFor this New Task request, replace the single HTML output contract with the structured tasks object. Return 1 to 10 tasks, each with a plain-text title and HTML description. Split only when the user's note clearly requests several separate, independently deliverable tasks (for example search focus, CSV export, and a typo fix). Keep sub-steps, acceptance criteria, and implementation details of one deliverable together in exactly one task, even for a long note. If uncertain, return one task. If more than 10 independent tasks are requested, return only the first 10 in request order. Preserve the board's style and all source details within each task; do not invent tasks. Do not include the title in the description.";
  }
  if (validateDraft && body.aiMode === "AiTaskWriter") {
    instructions += `\n\n${TASK_WRITER_RESEARCH_REQUEST_RULE}`;
  }
  const dueDateEnabled = body.requestKind === "compose-task" && body.aiMode === "AiTaskWriter" &&
    await isFeatureEnabled(HTPR_7054_CTRLJ_DUE_DATE_FLAG, userId);
  const dueDateContext = dueDateEnabled ? taskWriterDateContext(body.timeZone) : null;
  if (dueDateContext) {
    instructions += `\n\n${taskWriterDueDateInstructions(dueDateContext)}`;
    if (splitTasks) instructions += "\nFor structured tasks, put each task's own date in that task's dueDate field instead of a marker, and leave it null when that task has no deadline.";
  }
  const headingLanguageEnabled = body.aiMode === "AiTaskWriter" &&
    (await isFeatureEnabled(HTPR_7057_WRITER_HEADING_LANGUAGE_FLAG, userId));
  if (headingLanguageEnabled) {
    instructions += `\n\n${renderPrompt("task-writer-output-language")}`;
  }
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
    splitTasks,
    instructions,
    messages,
    allowedImgSrcs,
    validateDraft,
    skills: skillResolution.skills,
    usageTaskId,
    dueDateContext,
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
