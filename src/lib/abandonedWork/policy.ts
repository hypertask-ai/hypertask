export const QUIET_WITHOUT_OPEN_CHANGE_MS = 6 * 60 * 60 * 1000;
export const OPEN_CHANGE_QUIET_MS = 24 * 60 * 60 * 1000;
export const CAPACITY_MARGIN = 3;
export const VALENTIN_USER_ID = 6;
export type AssigneeFact = { userId: number; agentId: string | null; assignedAt: string };
export type PullRequestFact = { url: string; lifecycle: string; updatedAt: string | null };
export type ReactionFact = { emoji: string; at: string };
export type CommentFact = {
  id: number; createdAt: string; text: string; commentText: string; creatorId: number | null;
  agentId: string | null; agentDisplayName: string | null; kind: string | null; reactions: ReactionFact[];
};
export type SectionEventFact = { from: string; to: string; at: string };
export type AbandonedRow = {
  id: number; projectId: number; section: string; status: string; userId: number;
  sectionChangedAt: string | null; createdAt: string; lastCommentAt: string | null; lastRunAt: string | null;
  liveLeaseAt: string | null; assignees: AssigneeFact[]; pullRequests: PullRequestFact[];
  comments: CommentFact[]; sectionEvents: SectionEventFact[]; labels: string[];
};
export type BoardSpec = { projectId: number; inProgress: string; review: string; intakes: readonly string[]; defaultIntake: string };
export const BOARDS: readonly BoardSpec[] = [
  { projectId: 15, inProgress: "In Progress", review: "Valentin Review", intakes: ["Bugs", "Improvements", "Features"], defaultIntake: "Improvements" },
  { projectId: 2060, inProgress: "Doing", review: "Valentin Review", intakes: ["Todo"], defaultIntake: "Todo" },
];
export type ReleaseDecision =
  | { action: "keep"; reason: string }
  | { action: "release"; toSection: string; reason: string; pullRequestUrls: string[] };
const THUMBS = /^👍[\u{1f3fb}-\u{1f3ff}]?$/u;
function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function latest(values: Array<string | null | undefined>): number {
  let max = 0;
  for (const value of values) {
    const parsed = time(value);
    if (parsed != null && parsed > max) max = parsed;
  }
  return max;
}
function isQuestion(value: string | null | undefined): boolean {
  const text = (value ?? "").replace(/<\/?(?:p|div|li|h[1-6]|blockquote)\b[^>]*>|<br\s*\/?>/gi, "\n");
  return /(?:^|\n)\s*(?:<[^>\n]*>\s*)*question:/i.test(text);
}
function openPulls(row: AbandonedRow): PullRequestFact[] {
  return row.pullRequests.filter((pull) => pull.lifecycle.toLowerCase() === "open");
}
function stamps(row: AbandonedRow, open: PullRequestFact[]): Array<string | null | undefined> {
  return [row.createdAt, row.sectionChangedAt, row.lastCommentAt, row.lastRunAt, ...row.assignees.map((assignee) => assignee.assignedAt), ...open.map((pull) => pull.updatedAt)];
}
function freshRun(row: AbandonedRow, nowMs: number): boolean {
  const run = time(row.lastRunAt);
  return run != null && nowMs - run < QUIET_WITHOUT_OPEN_CHANGE_MS;
}
export function unansweredOwnerQuestion(row: AbandonedRow): boolean {
  const questions = row.comments.filter((comment) => Boolean(comment.agentId || comment.agentDisplayName) && (comment.kind === "question" || isQuestion(comment.text) || isQuestion(comment.commentText)));
  if (!questions.length) return false;
  const question = questions.reduce((left, right) => {
    const leftAt = time(left.createdAt) ?? 0;
    const rightAt = time(right.createdAt) ?? 0;
    return rightAt > leftAt || (rightAt === leftAt && right.id > left.id) ? right : left;
  });
  const askedAt = time(question.createdAt) ?? 0;
  const answered = row.comments.some((comment) => {
    const at = time(comment.createdAt) ?? 0;
    return comment.creatorId === VALENTIN_USER_ID && !comment.agentId && !comment.agentDisplayName && (at > askedAt || (at === askedAt && comment.id > question.id));
  });
  return !answered && !question.reactions.some((reaction) => THUMBS.test(reaction.emoji) && (time(reaction.at) ?? 0) > askedAt);
}
export function intakeSection(row: AbandonedRow, board: BoardSpec): string {
  const events = [...row.sectionEvents].sort((left, right) => (time(right.at) ?? 0) - (time(left.at) ?? 0));
  for (const event of events) if (event.to === board.inProgress && board.intakes.includes(event.from)) return event.from;
  for (const event of events) if (board.intakes.includes(event.from)) return event.from;
  const labels = row.labels.map((label) => label.trim().toLowerCase());
  if (board.projectId === 15 && labels.some((label) => label === "bug" || label === "bugs")) return "Bugs";
  if (board.projectId === 15 && labels.some((label) => label === "feature" || label === "features")) return "Features";
  return board.defaultIntake;
}
function inProgress(row: AbandonedRow, board: BoardSpec): boolean {
  return row.status === "Normal" && row.section === board.inProgress && row.projectId === board.projectId;
}
export function decideAbandoned(row: AbandonedRow, nowMs: number, board: BoardSpec): ReleaseDecision {
  if (!inProgress(row, board)) return { action: "keep", reason: "not in progress" };
  if (row.liveLeaseAt) return { action: "keep", reason: "active lease" };
  if (row.assignees.some((assignee) => !assignee.agentId)) return { action: "keep", reason: "human assignee" };
  if (row.assignees.length === 0 && freshRun(row, nowMs)) return { action: "keep", reason: "active run" };
  const open = openPulls(row);
  const quiet = nowMs - latest(stamps(row, open));
  const abandoned = row.assignees.length === 0 || (open.length ? quiet >= OPEN_CHANGE_QUIET_MS : quiet >= QUIET_WITHOUT_OPEN_CHANGE_MS);
  if (!abandoned) return { action: "keep", reason: open.length ? "open change still active" : "owner still active" };
  const urls = [...new Set(open.map((pull) => pull.url))].sort();
  const reason = row.assignees.length === 0 ? "unassigned" : open.length ? "open change quiet for 24 hours" : "quiet for 6 hours";
  return { action: "release", toSection: unansweredOwnerQuestion(row) ? board.review : intakeSection(row, board), reason, pullRequestUrls: urls };
}
export function handCount(rows: readonly AbandonedRow[], nowMs: number, board: BoardSpec): number {
  let count = 0;
  for (const row of rows) {
    if (!inProgress(row, board) || row.liveLeaseAt || row.assignees.some((assignee) => assignee.agentId == null)) continue;
    if (row.assignees.length === 0 && freshRun(row, nowMs)) continue;
    const open = row.pullRequests.filter((pull) => pull.lifecycle.toLowerCase() === "open");
    const quiet = nowMs - latest(stamps(row, open));
    if (row.assignees.length === 0 || (open.length ? quiet >= 24 * 60 * 60 * 1000 : quiet >= 6 * 60 * 60 * 1000)) count += 1;
  }
  return count;
}
export function planBoard(rows: readonly AbandonedRow[], nowMs: number, board: BoardSpec) {
  const releases = rows.flatMap((row) => {
    const decision = decideAbandoned(row, nowMs, board);
    return decision.action === "release" ? [{ id: row.id, toSection: decision.toSection, reason: decision.reason, pullRequestUrls: decision.pullRequestUrls }] : [];
  });
  const hand = handCount(rows, nowMs, board);
  return releases.length === hand ? { ok: true as const, releases } : { ok: false as const, preview: releases.length, hand };
}
export function releaseNote(toSection: string, urls: readonly string[]): string {
  const unique = [...new Set(urls)].sort();
  return `Returned abandoned work to ${toSection}.${unique.length ? ` Open changes still linked: ${unique.join(", ")}.` : ""}`;
}
export function capacityLimit(liveRunners: number): number {
  return liveRunners + CAPACITY_MARGIN;
}
export function shouldPostCapacityWarning(inProgress: number, liveRunners: number, recentAlerts: number): boolean {
  return recentAlerts === 0 && inProgress > capacityLimit(liveRunners);
}
export function capacityWarning(projectId: number, inProgress: number, liveRunners: number): string {
  return `Abandoned work capacity: board ${projectId} has ${inProgress} tickets In Progress. Live runners are ${liveRunners}. The limit is ${capacityLimit(liveRunners)}.`;
}
export async function commitIfStillAbandoned(snapshot: AbandonedRow, nowMs: number, board: BoardSpec, io: {
  lockAndReread: (id: number) => Promise<AbandonedRow | null>;
  apply: (row: AbandonedRow, decision: Extract<ReleaseDecision, { action: "release" }>) => Promise<void>;
}): Promise<"released" | "kept" | "missing"> {
  const fresh = await io.lockAndReread(snapshot.id);
  if (!fresh) return "missing";
  const decision = decideAbandoned(fresh, nowMs, board);
  if (decision.action !== "release") return "kept";
  await io.apply(fresh, decision);
  return "released";
}
export function sampleRow(overrides: Partial<AbandonedRow> = {}): AbandonedRow {
  return {
    id: 1, projectId: 15, section: "In Progress", status: "Normal", userId: 6, sectionChangedAt: "2026-11-07T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z", lastCommentAt: null, lastRunAt: null, liveLeaseAt: null, assignees: [],
    pullRequests: [], comments: [], sectionEvents: [], labels: [], ...overrides,
  };
}
