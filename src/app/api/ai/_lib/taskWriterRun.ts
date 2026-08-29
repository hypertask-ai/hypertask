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
} from "@/app/api/ai/_lib/editorAi";
import {
  loadCurrentTaskContext,
  resolveAiUsageTaskId,
} from "@/app/api/ai/_lib/currentTaskContext";
import { formatTaskWriterRetrievedContext } from "@/app/api/ai/_lib/taskWriterPrompt";
import { resolveSkills } from "@/app/api/ai/_lib/skills";
import { getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { BOARD_TEMPLATE_LIMIT } from "@/app/api/ai/_lib/boardTemplateContext";

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
  byokProviderFlags: z.array(byokProviderFlagSchema).optional().default([]),
});

export type TaskWriterRequest = z.infer<typeof taskWriterRequestSchema>;

/** Thrown when the team has switched this AI feature off. Callers map it to 403. */
export class AiFeatureDisabledError extends Error {
  constructor() {
    super("This AI feature is turned off for your team");
    this.name = "AiFeatureDisabledError";
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
  const primaryTaskIds = body.taskIds.slice(0, 1);
  const relatedTaskIds = body.taskIds.slice(1);
  const [
    currentTaskContext,
    relatedTaskContext,
    semanticContext,
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
      prompt: effectivePrompt,
      aiMode: body.aiMode,
      taskIds: body.taskIds,
    }),
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
  const instructions = skillResolution.systemPromptAddition
    ? `${baseInstructions}\n\n${skillResolution.systemPromptAddition}`
    : baseInstructions;
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
