import type { TaskWriterCustomFieldDefinition } from "@/lib/ai/taskWriterCustomFields";
import { renderPrompt } from "@/lib/ai/prompts/registry";

import type {
  TurbopufferCommentRow,
  TurbopufferTaskRow,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { buildTaskLink } from "@/lib/mcp-server/utils/task-link";

export const TASK_WRITER_RELATED_CANDIDATE_LIMIT = 8;
export const TASK_WRITER_CONTEXT_BUDGET = 50;
export const TASK_WRITER_MIN_COMMENT_ROWS = 15;
export const TASK_WRITER_MAX_TASK_CONTEXT_ROWS = 35;
export const TASK_WRITER_RETRIEVAL_QUERY_LIMIT = 4000;
export const TASK_WRITER_STYLE_EXAMPLE_LIMIT = 3;

export const TASK_WRITER_BOARD_RESEARCH_RULES = renderPrompt("task-writer-board-research-rules");
export const TASK_WRITER_BOARD_RESEARCH_WEB_RULES = renderPrompt("task-writer-board-research-web-rules");

function escapePlain(value: string) {
  return value
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildTaskWriterRetrievalQuery(args: {
  prompt: string;
  userRetrievalTexts?: string[] | null;
}) {
  const fromUser = (args.userRetrievalTexts ?? [])
    .map((text) => text.trim())
    .filter(Boolean);
  const raw =
    fromUser.length > 0 ? fromUser.join("\n") : args.prompt.trim();
  return raw.slice(0, TASK_WRITER_RETRIEVAL_QUERY_LIMIT);
}

export function mergeTaskWriterContextBudget(args: {
  taskRows: TurbopufferTaskRow[];
  commentRows: TurbopufferCommentRow[];
  maxTotal?: number;
  minComments?: number;
  maxTasks?: number;
}) {
  const maxTotal = args.maxTotal ?? TASK_WRITER_CONTEXT_BUDGET;
  const minComments = Math.min(
    args.minComments ?? TASK_WRITER_MIN_COMMENT_ROWS,
    args.commentRows.length,
    maxTotal
  );
  const maxTasks = Math.min(
    args.maxTasks ?? TASK_WRITER_MAX_TASK_CONTEXT_ROWS,
    maxTotal - minComments
  );
  const tasks = args.taskRows.slice(0, Math.max(0, maxTasks));
  const remaining = Math.max(0, maxTotal - tasks.length);
  const comments = args.commentRows.slice(0, remaining);
  return { taskRows: tasks, commentRows: comments };
}

export function taskWriterCandidateUrl(args: {
  projectId: number;
  uniqueIndex: number;
}) {
  return buildTaskLink(args.projectId, args.uniqueIndex);
}

export function formatRelatedTicketCandidates(
  rows: Array<{
    projectId: number;
    uniqueIndex: number;
    ticketNumber?: string | null;
    title?: string | null;
    descriptionText?: string | null;
    status?: string | null;
  }>
) {
  if (rows.length === 0) return "";
  const lines = rows.slice(0, TASK_WRITER_RELATED_CANDIDATE_LIMIT).map((row, index) => {
    const url = taskWriterCandidateUrl({
      projectId: row.projectId,
      uniqueIndex: row.uniqueIndex,
    });
    return [
      `candidate:${index + 1}`,
      `ticketNumber:${escapePlain(row.ticketNumber || "")}`,
      `uniqueIndex:${row.uniqueIndex}`,
      `projectId:${row.projectId}`,
      `url:${url}`,
      `title:${escapePlain(row.title || "")}`,
      `status:${escapePlain(row.status || "")}`,
      `description:${escapePlain((row.descriptionText || "").slice(0, 800))}`,
    ].join(" ");
  });
  return `<RELATED_TICKET_CANDIDATES>\n${lines.join("\n")}\n</RELATED_TICKET_CANDIDATES>`;
}

export function formatStyleExamples(
  rows: Array<{
    projectId: number;
    uniqueIndex: number;
    ticketNumber?: string | null;
    title?: string | null;
    descriptionText?: string | null;
    section?: string | null;
  }>
) {
  if (rows.length === 0) return "";
  const lines = rows.slice(0, TASK_WRITER_STYLE_EXAMPLE_LIMIT).map((row, index) => {
    const url = taskWriterCandidateUrl({
      projectId: row.projectId,
      uniqueIndex: row.uniqueIndex,
    });
    return [
      `example:${index + 1}`,
      `ticketNumber:${escapePlain(row.ticketNumber || "")}`,
      `url:${url}`,
      `section:${escapePlain(row.section || "")}`,
      `title:${escapePlain(row.title || "")}`,
      `description:${escapePlain((row.descriptionText || "").slice(0, 1200))}`,
    ].join(" ");
  });
  return `<STYLE_EXAMPLES>\n${lines.join("\n")}\n</STYLE_EXAMPLES>`;
}

export function formatBoardVocabulary(args: {
  projectTitle?: string | null;
  projectDescription?: string | null;
  sectionTitles?: string[];
  labelNames?: string[];
  labels?: { id: string; name: string }[];
  customFields?: TaskWriterCustomFieldDefinition[];
}) {
  const sectionTitles = (args.sectionTitles ?? []).slice(0, 40);
  const labelNames = (args.labelNames ?? []).slice(0, 40);
  const customFields = (args.customFields ?? []).slice(0, 50).map(({ id, name, type, options }) => ({
    id, name, type,
    ...(type === "Select" && Array.isArray(options) ? { options: options.map((option) => {
      if (!option || typeof option !== "object") return null;
      return { id: option.id, label: option.label };
    }).filter(Boolean) } : {}),
  }));
  const parts = [
    args.projectTitle ? `projectTitle:${escapePlain(args.projectTitle)}` : "",
    args.projectDescription
      ? `projectDescription:${escapePlain(args.projectDescription.slice(0, 1000))}`
      : "",
    sectionTitles.length
      ? `columns:${escapePlain(sectionTitles.join(" | "))}`
      : "",
    args.labels?.length
      ? `labels:${escapePlain(JSON.stringify(args.labels))}`
      : labelNames.length
      ? `labels:${escapePlain(labelNames.join(" | "))}`
      : "",
  ].filter(Boolean);
  const fieldsLine = customFieldsWithinBudget(customFields);
  if (parts.length === 0 && !fieldsLine) return "";
  const body = [parts.join("\n").slice(0, 4000), fieldsLine].filter(Boolean).join("\n");
  return `<BOARD_VOCABULARY>\n${body}\n</BOARD_VOCABULARY>`;
}

const CUSTOM_FIELDS_BUDGET = 3000;

function customFieldsWithinBudget(fields: object[]) {
  const kept: object[] = [];
  for (const field of fields) {
    if (escapePlain(JSON.stringify([...kept, field])).length > CUSTOM_FIELDS_BUDGET) break;
    kept.push(field);
  }
  return kept.length ? `customFields:${escapePlain(JSON.stringify(kept))}` : "";
}
