export const NEEDS_YOU_SPLIT = "Needs you";

export type NeedsYouNotice = {
  type: string;
  userId: number;
  taskId?: number | null;
  fromAgentId?: string | null;
  message?: string | null;
  comment?: { text?: string | null; kind?: string | null } | null;
  task?: {
    title?: string | null;
    waitingOnUserId?: number | null;
    priority?: { priority_index?: number | null } | null;
  } | null;
  needsYouScore?: number | null;
  needsYouEnabled?: boolean;
  needsYouSource?: string | null;
};

export function needsYouRules(notice: NeedsYouNotice) {
  const text = `${notice.task?.title ?? ""} ${notice.comment?.text ?? ""} ${notice.message ?? ""}`;
  const reasons = [
    { applies: notice.task?.waitingOnUserId === notice.userId, boost: 10, reason: "Waiting on you" },
    { applies: notice.type === "Mentioned", boost: 5, reason: "Mentions you" },
    { applies: !notice.fromAgentId && (notice.comment?.kind === "question" || /\?/.test(text)), boost: 3, reason: "Question" },
    { applies: /\b(money|pay|payment|charge|invoice|billing|access|permission|security|key|keys)\b/i.test(text), boost: 5, reason: "Money or access" },
    { applies: notice.task?.priority?.priority_index === 1, boost: 3, reason: "Urgent" },
  ].filter(({ applies }) => applies);
  return { score: Math.min(20, reasons.reduce((sum, { boost }) => sum + boost, 0)), reason: reasons.map(({ reason }) => reason).join("; ") || "Update" };
}

export function needsYouIndices(notices: NeedsYouNotice[]) {
  const byTask = new Map<number, number>();
  const score = (index: number) => notices[index].needsYouScore ?? needsYouRules(notices[index]).score;
  notices.forEach((notice, index) => {
    if (!notice.needsYouEnabled || notice.needsYouSource === "skipped" || !notice.taskId) return;
    const previous = byTask.get(notice.taskId);
    if (previous === undefined || score(index) > score(previous)) byTask.set(notice.taskId, index);
  });
  return [...byTask.values()].sort((a, b) => score(b) - score(a));
}
