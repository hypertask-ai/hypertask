import { isQuestionComment } from "@/lib/inboxDecisions";
import { inboxConfig } from "@/lib/configs/inbox.config";

/**
 * HTPR-7096: pure rules for a quiet owner inbox. Client safe, no flag reads.
 * Question detection is shared with HTPR-7092 (src/lib/inboxDecisions.ts), so the
 * Important split and the Decisions split agree.
 */
export { isQuestionComment };

type MentionRow = {
  type: string;
  fromAgentId?: string | null;
  comment?: { text?: string | null } | null;
  earnedAt?: string | Date;
  createdAt: string | Date;
  taskId: number | null;
};

/**
 * Whether a Mentioned row must stay out of Important. An agent mention counts
 * only when it is a Question that the viewer has not answered yet. Human
 * mentions and every other row type are never quiet.
 * `answeredAtByTaskId` holds the viewer's newest own comment time per task.
 */
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

/**
 * Whether one active event would put its task in Important today, mirroring
 * getInboxTabs: a mention that is not a quiet agent mention; an Important-split
 * type addressed to the viewer (always-addressed types, or assigned-only types
 * while the viewer is a human assignee) that is not agent housekeeping; a direct
 * reply; or a row the viewer snoozed and got back. Liveness is ignored on
 * purpose: a dead task never reaches Important, so keeping it is harmless.
 */
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
