import { isQuestionComment } from "@/lib/inboxDecisions";
import { inboxConfig } from "@/lib/configs/inbox.config";

export { isQuestionComment };

type MentionRow = {
  type: string;
  fromAgentId?: string | null;
  comment?: { text?: string | null } | null;
  earnedAt?: string | Date;
  createdAt: string | Date;
  taskId: number | null;
};

export function isQuietAgentMention(
  row: MentionRow,
  answeredAtByTaskId: ReadonlyMap<number, number>,
): boolean {
  if (row.type !== "Mentioned" || !row.fromAgentId) return false;
  if (!isQuestionComment(row.comment?.text)) return true;
  if (row.taskId == null) return false;
  const answeredAt = answeredAtByTaskId.get(row.taskId);
  if (answeredAt === undefined) return false;
  return answeredAt > new Date(row.earnedAt ?? row.createdAt).getTime();
}

type ActiveEvent = MentionRow & {
  directReply?: boolean | null;
  returnedFromReminders?: boolean | null;
};

export function eventKeepsImportant(
  event: ActiveEvent,
  answeredAtByTaskId: ReadonlyMap<number, number>,
  assignedToViewer: boolean,
): boolean {
  if (event.directReply === true) return true;
  if (event.type === "Mentioned") return !isQuietAgentMention(event, answeredAtByTaskId);
  if (!(inboxConfig.importantSplit as readonly string[]).includes(event.type)) return false;
  if (event.fromAgentId && (inboxConfig.agentSplitTypes as readonly string[]).includes(event.type)) {
    return false;
  }
  if (event.returnedFromReminders === true) return true;
  if ((inboxConfig.importantAddressedAlways as readonly string[]).includes(event.type)) return true;
  return (
    (inboxConfig.importantAddressedIfAssigned as readonly string[]).includes(event.type) &&
    assignedToViewer
  );
}
