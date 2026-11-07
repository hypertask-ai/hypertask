export const QUIET_WITHOUT_OPEN_CHANGE_MS = 6 * 60 * 60 * 1000;
export const OPEN_CHANGE_QUIET_MS = 24 * 60 * 60 * 1000;
export const CAPACITY_MARGIN = 3;
export const VALENTIN_USER_ID = 6;

export type AssigneeFact = {
  userId: number;
  agentId: string | null;
  assignedAt: string;
};

export type PullRequestFact = {
  url: string;
  lifecycle: string;
  updatedAt: string | null;
};

export type ReactionFact = {
  emoji: string;
  at: string;
};

export type CommentFact = {
  id: number;
  createdAt: string;
  text: string;
  commentText: string;
  creatorId: number | null;
  agentId: string | null;
  agentDisplayName: string | null;
  kind: string | null;
  reactions: ReactionFact[];
};

export type SectionEventFact = {
  from: string;
  to: string;
  at: string;
};

export type AbandonedRow = {
  id: number;
  ticketNumber: string | null;
  projectId: number;
  sectionId: number | null;
  section: string;
  status: string;
  userId: number;
  sectionChangedAt: string | null;
  createdAt: string;
  lastCommentAt: string | null;
  lastRunAt: string | null;
  liveLeaseAt: string | null;
  assignees: AssigneeFact[];
  pullRequests: PullRequestFact[];
  comments: CommentFact[];
  sectionEvents: SectionEventFact[];
  labels: string[];
};

export type BoardSpec = {
  projectId: number;
  inProgress: string;
  review: string;
  intakes: readonly string[];
  defaultIntake: string;
};

export const BOARDS: readonly BoardSpec[] = [
  {
    projectId: 15,
    inProgress: "In Progress",
    review: "Valentin Review",
    intakes: ["Bugs", "Improvements", "Features"],
    defaultIntake: "Improvements",
  },
  {
    projectId: 4060,
    inProgress: "In Progress",
    review: "Valentin Review",
    intakes: ["Backlog"],
    defaultIntake: "Backlog",
  },
];

export type ReleaseDecision =
  | { action: "keep"; reason: string }
  | {
      action: "release";
      toSection: string;
      reason: string;
      pullRequestUrls: string[];
    };

export type PlannedRelease = {
  id: number;
  toSection: string;
  reason: string;
  pullRequestUrls: string[];
};

const THUMBS = /^👍[\u{1f3fb}-\u{1f3ff}]?$/u;

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxTime(values: Array<string | null | undefined>): number | null {
  let latest: number | null = null;
  for (const value of values) {
    const parsed = time(value);
    if (parsed == null) continue;
    if (latest == null || parsed > latest) latest = parsed;
  }
  return latest;
}

function isQuestion(value: string | null | undefined): boolean {
  const text = (value ?? "").replace(/<\/?(?:p|div|li|h[1-6]|blockquote)\b[^>]*>|<br\s*\/?>/gi, "\n");
  return /(?:^|\n)\s*(?:<[^>\n]*>\s*)*question:/i.test(text);
}

function humanAssignees(row: AbandonedRow): AssigneeFact[] {
  return row.assignees.filter((assignee) => !assignee.agentId);
}

function openPullRequests(row: AbandonedRow): PullRequestFact[] {
  return row.pullRequests.filter((pullRequest) => pullRequest.lifecycle.toLowerCase() === "open");
}

function lifeMs(row: AbandonedRow): number {
  return maxTime([
    row.createdAt,
    row.sectionChangedAt,
    row.lastCommentAt,
    row.lastRunAt,
    ...row.assignees.map((assignee) => assignee.assignedAt),
    ...openPullRequests(row).map((pullRequest) => pullRequest.updatedAt),
  ]) ?? 0;
}

function manualQuietMs(row: AbandonedRow, nowMs: number): number {
  const stamps = [
    row.createdAt,
    row.sectionChangedAt,
    row.lastCommentAt,
    row.lastRunAt,
    ...row.assignees.map((assignee) => assignee.assignedAt),
    ...row.pullRequests
      .filter((pullRequest) => pullRequest.lifecycle.toLowerCase() === "open")
      .map((pullRequest) => pullRequest.updatedAt),
  ];
  let latest = 0;
  for (const stamp of stamps) {
    if (!stamp) continue;
    const parsed = Date.parse(stamp);
    if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
  }
  return nowMs - latest;
}

export function unansweredOwnerQuestion(row: AbandonedRow): boolean {
  const questions = row.comments.filter((comment) =>
    Boolean(comment.agentId || comment.agentDisplayName) &&
    (comment.kind === "question" || isQuestion(comment.text) || isQuestion(comment.commentText)),
  );
  if (!questions.length) return false;
  const question = questions.reduce((latest, comment) => {
    const left = time(latest.createdAt) ?? 0;
    const right = time(comment.createdAt) ?? 0;
    if (right > left) return comment;
    if (right === left && comment.id > latest.id) return comment;
    return latest;
  });
  const askedAt = time(question.createdAt) ?? 0;
  const answeredByReply = row.comments.some((comment) => {
    const at = time(comment.createdAt) ?? 0;
    return comment.creatorId === VALENTIN_USER_ID &&
      !comment.agentId &&
      !comment.agentDisplayName &&
      (at > askedAt || (at === askedAt && comment.id > question.id));
  });
  if (answeredByReply) return false;
  return !question.reactions.some((reaction) => {
    const at = time(reaction.at) ?? 0;
    return THUMBS.test(reaction.emoji) && at > askedAt;
  });
}

export function intakeSection(row: AbandonedRow, board: BoardSpec): string {
  const events = [...row.sectionEvents].sort((left, right) => (time(right.at) ?? 0) - (time(left.at) ?? 0));
  for (const event of events) {
    if (event.to === board.inProgress && board.intakes.includes(event.from)) return event.from;
  }
  for (const event of events) {
    if (board.intakes.includes(event.from)) return event.from;
  }
  if (board.projectId === 15) {
    const labels = row.labels.map((label) => label.trim().toLowerCase());
    if (labels.some((label) => label === "bug" || label === "bugs")) return "Bugs";
    if (labels.some((label) => label === "feature" || label === "features")) return "Features";
  }
  return board.defaultIntake;
}

function inProgress(row: AbandonedRow, board: BoardSpec): boolean {
  return row.status === "Normal" && row.section === board.inProgress && row.projectId === board.projectId;
}

export function decideAbandoned(row: AbandonedRow, nowMs: number, board: BoardSpec): ReleaseDecision {
  if (!inProgress(row, board)) return { action: "keep", reason: "not in progress" };
  if (row.liveLeaseAt) return { action: "keep", reason: "active lease" };
  if (humanAssignees(row).length) return { action: "keep", reason: "human assignee" };
  const open = openPullRequests(row);
  const quiet = nowMs - lifeMs(row);
  const abandoned = row.assignees.length === 0 ||
    (open.length > 0 ? quiet >= OPEN_CHANGE_QUIET_MS : quiet >= QUIET_WITHOUT_OPEN_CHANGE_MS);
  if (!abandoned) return { action: "keep", reason: open.length ? "open change still active" : "owner still active" };
  const urls = [...new Set(open.map((pullRequest) => pullRequest.url))].sort();
  const toSection = unansweredOwnerQuestion(row) ? board.review : intakeSection(row, board);
  const reason = row.assignees.length === 0
    ? "unassigned"
    : open.length
      ? "open change quiet for 24 hours"
      : "quiet for 6 hours";
  return { action: "release", toSection, reason, pullRequestUrls: urls };
}

export function handCount(rows: readonly AbandonedRow[], nowMs: number, board: BoardSpec): number {
  let count = 0;
  for (const row of rows) {
    if (row.status !== "Normal" || row.section !== board.inProgress || row.projectId !== board.projectId) continue;
    if (row.liveLeaseAt) continue;
    if (row.assignees.some((assignee) => assignee.agentId == null)) continue;
    const open = row.pullRequests.some((pullRequest) => pullRequest.lifecycle.toLowerCase() === "open");
    const quiet = manualQuietMs(row, nowMs);
    const abandoned = row.assignees.length === 0 || (open ? quiet >= 24 * 60 * 60 * 1000 : quiet >= 6 * 60 * 60 * 1000);
    if (abandoned) count += 1;
  }
  return count;
}

export function planBoard(
  rows: readonly AbandonedRow[],
  nowMs: number,
  board: BoardSpec,
): { ok: true; releases: PlannedRelease[] } | { ok: false; preview: number; hand: number } {
  const releases: PlannedRelease[] = [];
  for (const row of rows) {
    const decision = decideAbandoned(row, nowMs, board);
    if (decision.action === "release") {
      releases.push({
        id: row.id,
        toSection: decision.toSection,
        reason: decision.reason,
        pullRequestUrls: decision.pullRequestUrls,
      });
    }
  }
  const hand = handCount(rows, nowMs, board);
  if (releases.length !== hand) return { ok: false, preview: releases.length, hand };
  return { ok: true, releases };
}

export function releaseNote(toSection: string, urls: readonly string[]): string {
  const unique = [...new Set(urls)].sort();
  const links = unique.length ? ` Open changes still linked: ${unique.join(", ")}.` : "";
  return `Returned abandoned work to ${toSection}.${links}`;
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

export async function commitIfStillAbandoned(
  snapshot: AbandonedRow,
  nowMs: number,
  board: BoardSpec,
  io: {
    lockAndReread: (id: number) => Promise<AbandonedRow | null>;
    apply: (row: AbandonedRow, decision: Extract<ReleaseDecision, { action: "release" }>) => Promise<void>;
  },
): Promise<"released" | "kept" | "missing"> {
  const fresh = await io.lockAndReread(snapshot.id);
  if (!fresh) return "missing";
  const decision = decideAbandoned(fresh, nowMs, board);
  if (decision.action !== "release") return "kept";
  await io.apply(fresh, decision);
  return "released";
}

export async function proveResumedWorkSurvives(): Promise<boolean> {
  const board = BOARDS[0];
  const now = Date.parse("2026-11-07T12:00:00.000Z");
  const stale = sampleRow({
    sectionChangedAt: "2026-11-07T00:00:00.000Z",
    assignees: [{ userId: 6, agentId: "runner", assignedAt: "2026-11-07T00:00:00.000Z" }],
  });
  const resumed = sampleRow({
    sectionChangedAt: "2026-11-07T00:00:00.000Z",
    lastCommentAt: "2026-11-07T11:50:00.000Z",
    assignees: [{ userId: 6, agentId: "runner", assignedAt: "2026-11-07T00:00:00.000Z" }],
  });
  let released = false;
  const lost = await commitIfStillAbandoned(stale, now, board, {
    lockAndReread: async () => stale,
    apply: async () => {
      released = true;
    },
  });
  if (lost !== "released" || !released) return false;
  released = false;
  const kept = await commitIfStillAbandoned(stale, now, board, {
    lockAndReread: async () => resumed,
    apply: async () => {
      released = true;
    },
  });
  return kept === "kept" && !released;
}

export function sampleRow(overrides: Partial<AbandonedRow> = {}): AbandonedRow {
  return {
    id: 1,
    ticketNumber: "HTPR-1",
    projectId: 15,
    sectionId: 4309,
    section: "In Progress",
    status: "Normal",
    userId: 6,
    sectionChangedAt: "2026-11-07T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    lastCommentAt: null,
    lastRunAt: null,
    liveLeaseAt: null,
    assignees: [],
    pullRequests: [],
    comments: [],
    sectionEvents: [],
    labels: [],
    ...overrides,
  };
}
