/**
 * HTPR-6363: board research helpers for the AI task writer.
 * Pure formatting and prompt rules live here so shared TASK_AUTHORING_STYLE
 * stays untouched when the feature flag is off.
 */

import type {
  TurbopufferCommentRow,
  TurbopufferTaskRow,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { buildTaskLink } from "@/lib/mcp-server/utils/task-link";

export const HTPR_6363_TASK_WRITER_RESEARCH_FLAG =
  "htpr-6363-task-writer-research";

export const TASK_WRITER_RELATED_CANDIDATE_LIMIT = 8;
export const TASK_WRITER_CONTEXT_BUDGET = 50;
export const TASK_WRITER_MIN_COMMENT_ROWS = 15;
export const TASK_WRITER_MAX_TASK_CONTEXT_ROWS = 35;
export const TASK_WRITER_RETRIEVAL_QUERY_LIMIT = 4000;
export const TASK_WRITER_STYLE_EXAMPLE_LIMIT = 3;

/** Appended only when htpr-6363-task-writer-research is on for the caller. */
export const TASK_WRITER_BOARD_RESEARCH_RULES = `<h3>BOARD RESEARCH (flagged; outranks brevity, not source fidelity for marketing copy)</h3>
- Before drafting, read RELATED_TICKET_CANDIDATES, STYLE_EXAMPLES, and BOARD_VOCABULARY in context.
- Classify every candidate as one of: duplicate, builds on, blocked by, unrelated. Cite only candidates listed there. Never invent a ticket id, URL, title, or outcome.
- If any candidate is a duplicate of the brief, stop drafting a full ticket. Output only:
  - \`<h1 id="ai-generated-task-title">Possible duplicate</h1>\`
  - one paragraph naming the match with its server-provided URL
  - one sentence on what differs, or "Not provided." if unknown
  - the usual Proposed properties paragraph last
- Otherwise include an <h2>Related tickets</h2> section. For each non-unrelated hit, one bullet: relationship, ticket link from the candidate record, and a one-line outcome from that ticket's text. Cap at 8. If every hit is unrelated, write one bullet: "No close matches on this board."
- Mirror vocabulary from BOARD_VOCABULARY and the shape of STYLE_EXAMPLES when they exist. Do not copy their marketing lines into this ticket unless the brief already contains them.
- Structure the body with <h2> sections covering: problem, affected screen, acceptance criteria, out of scope. Use board template headings instead when a template matches.
- Source fidelity still bans inventing marketing copy, headlines, slogans, metrics, dates, owners, tooling choices, severities, versions, and numbers that are absent from the brief and retrieved context.
- You MAY propose acceptance criteria, related-ticket links, and out-of-scope bullets when they are grounded in the brief or retrieved board context. Label guesses with "Proposed:" so they are not presented as given facts.
- When the brief is thin (missing affected screen, acceptance criteria, or a concrete example), do not invent those facts. End with <h2>Open questions</h2> and exactly 2 or 3 <li> questions the user can answer in the refine box. Prefer questions over filler.
- Refinement means add board-grounded detail, related tickets, or a duplicate warning. Do not merely rephrase the latest instruction.`;

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
}) {
  const parts = [
    args.projectTitle ? `projectTitle:${escapePlain(args.projectTitle)}` : "",
    args.projectDescription
      ? `projectDescription:${escapePlain(args.projectDescription.slice(0, 1000))}`
      : "",
    args.sectionTitles?.length
      ? `columns:${escapePlain(args.sectionTitles.join(" | "))}`
      : "",
    args.labelNames?.length
      ? `labels:${escapePlain(args.labelNames.join(" | "))}`
      : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return `<BOARD_VOCABULARY>\n${parts.join("\n")}\n</BOARD_VOCABULARY>`;
}
