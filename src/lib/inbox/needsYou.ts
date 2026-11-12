import type { Assignees, Comment, Notification, Priority, Project, Section, Task } from "@prisma/client";
import { doneColumnTitles, isDoneColumn } from "@/lib/doneColumns";
import { isQuestionComment } from "@/lib/inboxDecisions";

export const NEEDS_YOU_SPLIT = "Needs you";
export type NeedsYouNotice = Pick<Notification, "type" | "userId"> &
  Partial<Pick<Notification, "taskId" | "fromAgentId" | "message" | "needsYouScore" | "needsYouSource" | "directReply">> & {
    comment?: Partial<Pick<Comment, "text" | "kind">> | null;
    task?: Partial<Pick<Task, "title" | "waitingOnUserId" | "waitingOnAgentId" | "status" | "section">> & { priority?: Partial<Pick<Priority, "priority_index">> | null; assignees?: Partial<Pick<Assignees, "userId" | "agentId">>[] } | null;
    project?: Partial<Pick<Project, "id" | "teamId">> & { section?: Pick<Section, "section_title" | "isDone">[] } | null;
    needsYouEnabled?: boolean;
    isDecision?: boolean;
    quietImportant?: boolean;
  };

function actionPriority(notice: NeedsYouNotice) {
  const doneTitles = notice.project?.section ? doneColumnTitles(notice.project.section) : undefined;
  if (notice.task?.status === "Archive" || isDoneColumn(notice.task?.section, doneTitles)) return 0;
  if (notice.task?.waitingOnUserId === notice.userId && !notice.task?.waitingOnAgentId) return 3;
  if (notice.isDecision) return 2;
  if (notice.quietImportant) return 0;
  const question = notice.comment?.kind === "question" || isQuestionComment(notice.comment?.text) ||
    (!notice.fromAgentId && notice.type === "Comment" && /\?/.test(notice.comment?.text ?? ""));
  if (notice.type === "Mentioned" && (!notice.fromAgentId || question)) return question ? 2 : 1;
  const assignedToYou = notice.task?.assignees?.some((assignee) => assignee.userId === notice.userId && !assignee.agentId);
  if (question && (notice.directReply || (notice.type === "Comment" && assignedToYou))) return 2;
  return 0;
}

export function needsYouRules(notice: NeedsYouNotice) {
  const text = `${notice.comment?.text ?? ""} ${notice.message ?? ""}`;
  const reasons = [
    { applies: notice.task?.waitingOnUserId === notice.userId && !notice.task?.waitingOnAgentId, boost: 10, reason: "Waiting on you" },
    { applies: notice.type === "Mentioned", boost: 5, reason: "Mentions you" },
    { applies: notice.comment?.kind === "question" || isQuestionComment(text) || (!notice.fromAgentId && notice.type === "Comment" && /\?/.test(text)), boost: 3, reason: "Question" },
    { applies: actionPriority(notice) > 0 && /\b(money|pay|payment|charge|invoice|billing|access|permission|security|key|keys)\b/i.test(text), boost: 5, reason: "Money or access" },
    { applies: notice.task?.priority?.priority_index === 1, boost: 3, reason: "Urgent" },
  ].filter(({ applies }) => applies);
  return { score: Math.min(20, reasons.reduce((sum, { boost }) => sum + boost, 0)), reason: reasons.map(({ reason }) => reason).join("; ") || "Update" };
}

export function needsYouIndices(notices: NeedsYouNotice[]) {
  const byTask = new Map<number, { index: number; priority: number; score: number }>();
  notices.forEach((notice, index) => {
    if (!notice?.needsYouEnabled || notice.needsYouSource === "skipped" || !notice.taskId) return;
    const priority = actionPriority(notice);
    if (!priority) return;
    const rules = needsYouRules(notice);
    const score = notice.needsYouSource === "jev" ? notice.needsYouScore ?? rules.score : rules.score;
    const previous = byTask.get(notice.taskId);
    if (!previous || priority > previous.priority || (priority === previous.priority && score > previous.score)) {
      byTask.set(notice.taskId, { index, priority, score });
    }
  });
  return [...byTask.values()].sort((a, b) => b.priority - a.priority || b.score - a.score).map(({ index }) => index);
}
