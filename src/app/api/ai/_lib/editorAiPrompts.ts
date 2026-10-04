import { renderPrompt } from "@/lib/ai/prompts/registry";
import { I_HAVE_ADHD_SKILL, STRUCTURED_WRITING_STYLE, UNSLOP_SKILL } from "@/app/api/ai/_lib/writingSkills";
import { createTaskWriterSystemPromptTemplate, wrapTaskWriterContext } from "@/app/api/ai/_lib/taskWriterPrompt";
import { createBoardTemplatesBlock, type BoardTemplateContext } from "@/app/api/ai/_lib/boardTemplateContext";

export const NVC_STYLE_RULE = renderPrompt("nvc-style-rule");

export const HOUSE_OUTPUT_STYLE = renderPrompt("house-output-style", (NVC_STYLE_RULE));

// HTPR-5606: the authoring style for the AI Task Writer and Write with AI.
// Same two skill files as the Improve button, verbatim, plus the two rules
// that only matter when the model AUTHORS rather than rewrites: it must not
// write content the brief never gave it, and it must not drop content the
// brief did give it. A demo run on INNE-1576 invented 95 words of German and
// English subheadlines the source never contained; that is what these stop.
export const TASK_AUTHORING_STYLE = renderPrompt("task-authoring-style", (UNSLOP_SKILL), (I_HAVE_ADHD_SKILL));

export function createPromptForTiptapForwardSlash(
  mode = "FixSpellingAndGrammar",
  inputHtml = "",
  instruction = "",
) {
  if (mode === "FixSpellingAndGrammar") {
    return renderPrompt("editor-ai-prompts-context-4", (NVC_STYLE_RULE));
  }

  if (mode === "Summarize") {
    return renderPrompt("editor-ai-prompts-context-5", (HOUSE_OUTPUT_STYLE));
  }

  if (mode === "MakeShorter") {
    return renderPrompt("editor-ai-prompts-context-6", (HOUSE_OUTPUT_STYLE));
  }

  if (mode.startsWith("Translate")) {
    const language = mode.includes(":")
      ? mode.split(":", 2)[1]?.trim() || "English"
      : "English";
    return renderPrompt("editor-ai-prompts-context-7", (language));
  }

  if (mode === "Simplify") {
    return renderPrompt("editor-ai-prompts-context-8", (HOUSE_OUTPUT_STYLE));
  }

  if (mode === "Unslop") {
    return renderPrompt("editor-ai-prompts-context-9", (HOUSE_OUTPUT_STYLE));
  }

  if (mode === "ImproveReadability" || mode === "Structured") {
    return renderPrompt("editor-ai-prompts-context-10", (STRUCTURED_WRITING_STYLE), (HOUSE_OUTPUT_STYLE));
  }

  if (mode === "CustomEdit" || mode.startsWith("CustomEdit:")) {
    const requestedInstruction =
      instruction.trim() || mode.slice("CustomEdit:".length).trim();
    return renderPrompt("editor-ai-prompts-context-11", (requestedInstruction || "Improve the writing while preserving meaning."), (HOUSE_OUTPUT_STYLE));
  }

  if (mode === "WriteContent" || mode.startsWith("WriteContent:")) {
    const requestedInstruction =
      instruction.trim() || mode.slice("WriteContent:".length).trim();
    return renderPrompt("editor-ai-prompts-context-12", (requestedInstruction || "Write a short useful draft."), (TASK_AUTHORING_STYLE));
  }

  return renderPrompt("editor-ai-prompts-context-13");
}

export function createKanbanSystemPrompt(mode = "default") {
  if (mode === "task_writer") {
    return createTaskWriterSystemPromptTemplate(TASK_AUTHORING_STYLE);
  }

  if (mode === "write_with_ai") {
    return renderPrompt("editor-ai-prompts-context-14", (TASK_AUTHORING_STYLE));
  }

  return renderPrompt("editor-ai-prompts-context-15");
}

export function createTaskAndModelContext(args: {
  taskIds?: number[];
  modelSelected: string;
  taskDescription?: string;
  taskTitle?: string;
}) {
  const taskIds = args.taskIds ?? [];
  let context = renderPrompt("editor-ai-prompts-context-16", (args.modelSelected));

  if (taskIds.length > 1) {
    context += renderPrompt("editor-ai-prompts-context-17", (taskIds[0]), (taskIds.slice(1).join(", ")), (taskIds[0]), (taskIds.slice(1).join(", ")));
  }

  if (
    (args.taskDescription ?? "").length > 0 &&
    (args.taskTitle ?? "").length > 0
  ) {
    context += renderPrompt("editor-ai-prompts-context-18", (args.taskTitle), (escapeHtml(args.taskDescription ?? "")));
  }

  return context;
}

export function createUploadedDocumentsContext(uploadedDocuments: string) {
  return renderPrompt("editor-ai-prompts-context-19", (uploadedDocuments));
}

export function createTaskWriterPromptParts(args: {
  aiMode?: string | null;
  customInstructions?: string | null;
  boardTemplates?: BoardTemplateContext[];
  modelSelected: string;
  taskIds?: number[];
  taskDescription?: string | null;
  taskTitle?: string | null;
  retrievedContext: string;
  uploadedDocumentContext?: string;
  input: string;
}) {
  const promptMode =
    args.aiMode === "AiTaskWriter"
      ? "task_writer"
      : args.aiMode === "WriteWithAI"
        ? "write_with_ai"
        : "default";

  const instructions = createKanbanSystemPrompt(promptMode);

  const reminderParts: string[] = [];
  // Board custom instructions apply in every AI entry point, WriteWithAI
  // included. A board sets policy there ("never claim disease prevention in ad
  // copy"), and policy that holds in one entry point but not another is a
  // compliance footgun, not a feature (HTPR-4356).
  const customInstructions = args.customInstructions
    ? `<CUSTOM_INSTRUCTION>${args.customInstructions}</CUSTOM_INSTRUCTION>`
    : "";
  if (customInstructions) reminderParts.push(customInstructions);
  const boardTemplates = createBoardTemplatesBlock(args.boardTemplates);
  if (boardTemplates) reminderParts.push(boardTemplates);

  const escapedDescription = escapeHtml(args.taskDescription ?? "");
  const taskModelContext = createTaskAndModelContext({
    taskIds: args.taskIds,
    modelSelected: args.modelSelected,
    taskDescription: escapedDescription,
    taskTitle: args.taskTitle ?? "",
  });
  if (taskModelContext) reminderParts.push(taskModelContext);

  if (args.uploadedDocumentContext) {
    reminderParts.push(
      createUploadedDocumentsContext(args.uploadedDocumentContext)
    );
  }

  const systemReminder = reminderParts.length
    ? "<system-reminder>\n" +
      reminderParts.join("\n") +
      "\n</system-reminder>\n\n"
    : "";
  // Retrieved ticket text is user-authored data. Keep it in the user message,
  // below the actual system instructions, so a comment cannot become policy by
  // imitating one of the prompt's XML-like delimiters.
  const retrievedContext = args.retrievedContext
    ? wrapTaskWriterContext(args.retrievedContext) + "\n\n"
    : "";
  const input = systemReminder + retrievedContext + args.input;

  return { instructions, input };
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
