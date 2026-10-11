import { renderPrompt } from "@/lib/ai/prompts/registry";
import {
  BOARD_TEMPLATE_FINAL_CHECK,
  BOARD_TEMPLATE_MATCH_RULE,
} from "@/app/api/ai/_lib/boardTemplateContext";

export const TASK_WRITER_CONTEXT_SYNTHESIS_RULES = renderPrompt("task-writer-context-synthesis-rules");
export const TASK_WRITER_RESEARCH_REQUEST_RULE = renderPrompt("task-writer-research-request-rule");

export function wrapTaskWriterContext(context: string) {
  return `<CONTEXT>${context}</CONTEXT>`;
}

function escapeContextValue(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatTaskWriterRetrievedContext(args: {
  currentTaskContext: string;
  relatedContext: string;
  relatedCandidates?: string;
  styleExamples?: string;
  boardVocabulary?: string;
}) {
  return [
    args.currentTaskContext
      ? `<CURRENT_TICKET_CONTEXT>\n${escapeContextValue(args.currentTaskContext)}\n</CURRENT_TICKET_CONTEXT>`
      : "",
    args.relatedCandidates || "",
    args.styleExamples || "",
    args.boardVocabulary || "",
    args.relatedContext
      ? `<RELATED_CONTEXT>\n${escapeContextValue(args.relatedContext)}\n</RELATED_CONTEXT>`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function excludeLoadedTaskRows<
  TTask extends { id: string },
  TComment extends { taskId: string },
>(args: {
  taskRows: TTask[];
  commentRows: TComment[];
  loadedTaskIds: number[];
}) {
  const loadedTaskIdSet = new Set(args.loadedTaskIds.map(String));
  if (loadedTaskIdSet.size === 0) {
    return { taskRows: args.taskRows, commentRows: args.commentRows };
  }
  return {
    taskRows: args.taskRows.filter((row) => !loadedTaskIdSet.has(row.id)),
    commentRows: args.commentRows.filter(
      (row) => !loadedTaskIdSet.has(row.taskId)
    ),
  };
}

export function createTaskWriterSystemPromptTemplate(houseOutputStyle: string) {
  return renderPrompt("task-writer-prompt-context-2", (houseOutputStyle), (BOARD_TEMPLATE_MATCH_RULE), (TASK_WRITER_CONTEXT_SYNTHESIS_RULES), (BOARD_TEMPLATE_FINAL_CHECK));
}
