import { generateText } from "ai";
import { configureAiModelUsage } from "./modelProvider";
import { filterOneImagePass } from "./editorAi";
import { taskWriterPlaceholderFeedback, prepareTaskWriterRun, type TaskWriterRequest } from "./taskWriterRun";
import { extractTaskWriterProperties, hasUsableTaskWriterDraft, TASK_WRITER_EMPTY_DRAFT_MESSAGE } from "./taskWriterProperties";
import { taskTitleFromBrief } from "@/lib/ai/taskWriterDuplicateGuard";

export async function generateTaskWriterDraft(
  body: TaskWriterRequest,
  userId: number,
  agentId?: string | null,
  abortSignal?: AbortSignal
) {
  const {
    selected,
    instructions,
    messages,
    allowedImgSrcs,
    skills,
    usageTaskId,
    validateDraft,
    taskTemplatesEnabled,
    customFieldDefinitions,
    boardLabelIds,
  } = await prepareTaskWriterRun(body, userId, agentId);

  configureAiModelUsage(selected.model, {
    userId,
    teamId: selected.teamId,
    projectId: body.projectId,
    taskId: usageTaskId,
    agentId: agentId,
    provider: selected.usageProvider,
    feature: "task-writer",
  });
  const options = {
    model: selected.model,
    instructions,
    messages,
    tools: selected.tools,
    maxRetries: 2,
    providerOptions: selected.providerOptions,
    ...selected.settings,
    ...(abortSignal ? { abortSignal } : {}),
  };
  let { text } = await generateText(options);
  const feedback = taskTemplatesEnabled ? taskWriterPlaceholderFeedback(text) : null;
  if (feedback) {
    ({ text } = await generateText({
      ...options,
      messages: [...messages, { role: "assistant", content: text }, { role: "user", content: feedback }],
    }));
  }

  const filtered = allowedImgSrcs
    ? filterOneImagePass(text, allowedImgSrcs).emit
    : text;
  const fieldTools = customFieldDefinitions ? await import("@/lib/ai/taskWriterCustomFields") : null;
  const fieldDraft = fieldTools?.readTaskWriterCustomFields(filtered);
  const draftHtml = fieldDraft?.html ?? filtered;
  const properties =
    body.aiMode === "AiTaskWriter"
      ? extractTaskWriterProperties(draftHtml, {
          boardLabelIds,
          fallbackTitle:
            body.taskTitle.trim() || taskTitleFromBrief(body.PROMPT),
        })
      : { title: null, description: draftHtml };

  if (validateDraft && !hasUsableTaskWriterDraft(properties.description)) {
    return { success: false as const, error: TASK_WRITER_EMPTY_DRAFT_MESSAGE };
  }

  return {
    success: true as const,
    ...(fieldDraft && customFieldDefinitions?.length ? { customFields: fieldTools!.validateTaskWriterCustomFields(customFieldDefinitions, fieldDraft.customFields) } : {}),
    ...("labelIds" in properties && properties.labelIds ? { labelIds: properties.labelIds } : {}),
    html: properties.description,
    title: properties.title,
    priority: "priority" in properties ? properties.priority : undefined,
    estimate: "estimate" in properties ? properties.estimate : undefined,
    model: selected.modelId,
    provider: selected.usageProvider,
    skills: skills.map((skill) => ({ slug: skill.slug, name: skill.name })),
  };
}
