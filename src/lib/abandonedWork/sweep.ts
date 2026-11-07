import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { lockAgentMutationFence } from "@/lib/mcp/tasks/agentMutationFence";
import { FEATURE_FLAG_OWNER_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_8909_ABANDONED_WORK_FLAG } from "@/lib/flags/definitions/htpr-8909-abandoned-work";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import {
  BOARDS,
  capacityWarning,
  decideAbandoned,
  planBoard,
  releaseNote,
  shouldPostCapacityWarning,
  type AbandonedRow,
  type AssigneeFact,
  type BoardSpec,
  type CommentFact,
  type PullRequestFact,
  type SectionEventFact,
} from "./policy";

type SectionRef = { id: number; projectId: number; title: string };

type RawBoardRow = {
  id: number;
  ticketNumber: string | null;
  projectId: number;
  sectionId: number | null;
  section: string;
  status: string;
  userId: number;
  sectionChangedAt: Date | null;
  createdAt: Date;
  lastCommentAt: Date | null;
  lastRunAt: Date | null;
  liveLeaseAt: Date | null;
  assignees: unknown;
  pullRequests: unknown;
  comments: unknown;
  sectionEvents: unknown;
  labels: unknown;
  recentAlerts: number;
};

export type BoardSweepResult = {
  projectId: number;
  inProgress: number;
  preview: number;
  hand: number;
  mismatch: boolean;
  released: number;
  kept: number;
  failed: number;
  capacityWarning: boolean;
  dryRun: boolean;
};

export type SweepResult = {
  enabled: boolean;
  liveRunners: number;
  boards: BoardSweepResult[];
};

function stamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toRow(raw: RawBoardRow): AbandonedRow {
  return {
    id: raw.id,
    ticketNumber: raw.ticketNumber,
    projectId: raw.projectId,
    sectionId: raw.sectionId,
    section: raw.section,
    status: raw.status,
    userId: raw.userId,
    sectionChangedAt: stamp(raw.sectionChangedAt),
    createdAt: stamp(raw.createdAt) ?? new Date(0).toISOString(),
    lastCommentAt: stamp(raw.lastCommentAt),
    lastRunAt: stamp(raw.lastRunAt),
    liveLeaseAt: stamp(raw.liveLeaseAt),
    assignees: asArray<AssigneeFact>(raw.assignees).map((assignee) => ({
      userId: Number(assignee.userId),
      agentId: assignee.agentId ?? null,
      assignedAt: stamp(assignee.assignedAt) ?? new Date(0).toISOString(),
    })),
    pullRequests: asArray<PullRequestFact>(raw.pullRequests).map((pullRequest) => ({
      url: String(pullRequest.url ?? ""),
      lifecycle: String(pullRequest.lifecycle ?? ""),
      updatedAt: stamp(pullRequest.updatedAt),
    })),
    comments: asArray<CommentFact>(raw.comments).map((comment) => ({
      id: Number(comment.id),
      createdAt: stamp(comment.createdAt) ?? new Date(0).toISOString(),
      text: String(comment.text ?? ""),
      commentText: String(comment.commentText ?? ""),
      creatorId: comment.creatorId == null ? null : Number(comment.creatorId),
      agentId: comment.agentId ?? null,
      agentDisplayName: comment.agentDisplayName ?? null,
      kind: comment.kind ?? null,
      reactions: asArray<{ emoji: string; at: string }>(comment.reactions).map((reaction) => ({
        emoji: String(reaction.emoji ?? ""),
        at: stamp(reaction.at) ?? new Date(0).toISOString(),
      })),
    })),
    sectionEvents: asArray<SectionEventFact>(raw.sectionEvents).map((event) => ({
      from: String(event.from ?? ""),
      to: String(event.to ?? ""),
      at: stamp(event.at) ?? new Date(0).toISOString(),
    })),
    labels: asArray<string>(raw.labels).map((label) => String(label ?? "")).filter(Boolean),
  };
}

const snapshotSql = (taskFilter: Prisma.Sql) => Prisma.sql`
  SELECT
    t.id,
    t."ticketNumber",
    t."projectId",
    t."sectionId",
    t.section,
    t.status::text AS status,
    t."userId",
    t."sectionChangedAt",
    t."createdAt",
    (SELECT MAX(c."createdAt") FROM "Comment" c WHERE c."taskId" = t.id AND c.activity IS NULL) AS "lastCommentAt",
    (SELECT MAX(r."lastActivityAt") FROM "AgentRun" r WHERE r."taskId" = t.id) AS "lastRunAt",
    (SELECT MAX(l."heartbeatAt") FROM "TaskLease" l WHERE l."taskId" = t.id AND l."expiresAt" > now()) AS "liveLeaseAt",
    COALESCE((
      SELECT json_agg(json_build_object(
        'userId', a."userId",
        'agentId', a."agentId",
        'assignedAt', to_char(a."assignedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ))
      FROM "Assignees" a WHERE a."taskId" = t.id
    ), '[]'::json) AS assignees,
    COALESCE((
      SELECT json_agg(json_build_object(
        'url', p.url,
        'lifecycle', p.lifecycle,
        'updatedAt', to_char(p."updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ))
      FROM "TaskPullRequest" p WHERE p."taskId" = t.id
    ), '[]'::json) AS "pullRequests",
    COALESCE((
      SELECT json_agg(json_build_object(
        'id', c.id,
        'createdAt', to_char(c."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'text', left(c.text, 12000),
        'commentText', left(c."commentText", 12000),
        'creatorId', c."creatorId",
        'agentId', c."agentId",
        'agentDisplayName', c."agentDisplayName",
        'kind', c.kind,
        'reactions', COALESCE((
          SELECT json_agg(json_build_object(
            'emoji', reaction.emoji,
            'at', to_char(COALESCE(reaction."updatedAt", reaction."createdAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ))
          FROM "Reaction" reaction
          WHERE reaction."commentId" = c.id
            AND reaction."isDeleted" = false
            AND reaction."userId" = ${6}
            AND reaction."agentId" IS NULL
        ), '[]'::json)
      ))
      FROM "Comment" c
      WHERE c."taskId" = t.id
        AND c.activity IS NULL
        AND (
          c.kind = 'question'
          OR c.text ILIKE '%question:%'
          OR c."commentText" ILIKE '%question:%'
          OR (c."creatorId" = ${6} AND c."agentId" IS NULL AND c."agentDisplayName" IS NULL)
        )
    ), '[]'::json) AS comments,
    COALESCE((
      SELECT json_agg(json_build_object(
        'from', event.from,
        'to', event.to,
        'at', to_char(event.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY event.timestamp DESC)
      FROM (
        SELECT e.from, e.to, e.timestamp
        FROM "TaskSectionEvent" e
        WHERE e."taskId" = t.id
        ORDER BY e.timestamp DESC
        LIMIT 20
      ) event
    ), '[]'::json) AS "sectionEvents",
    COALESCE((
      SELECT json_agg(label.value) FROM "TaskLabel" task_label
      JOIN "Label" label ON label.id = task_label."labelId"
      WHERE task_label."taskId" = t.id AND label.value IS NOT NULL
    ), '[]'::json) AS labels,
    (
      SELECT COUNT(*)::int FROM "Comment" alert
      JOIN "Task" alert_task ON alert_task.id = alert."taskId"
      WHERE alert_task."projectId" = t."projectId"
        AND alert."createdAt" > now() - interval '24 hours'
        AND alert."commentText" LIKE 'Abandoned work capacity:%'
    ) AS "recentAlerts"
  FROM "Task" t
  WHERE ${taskFilter}
`;

async function readBoardOnce(projectId: number): Promise<RawBoardRow[]> {
  return prisma.$queryRaw<RawBoardRow[]>(snapshotSql(Prisma.sql`
    t."projectId" = ${projectId}
    AND t.status = 'Normal'
    AND t.section = 'In Progress'
  `));
}

async function rereadTask(tx: Prisma.TransactionClient, taskId: number): Promise<AbandonedRow | null> {
  const rows = await tx.$queryRaw<RawBoardRow[]>(snapshotSql(Prisma.sql`t.id = ${taskId}`));
  return rows[0] ? toRow(rows[0]) : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character] ?? character
  ));
}

function noteHtml(toSection: string, urls: readonly string[]): string {
  const sentence = `Returned abandoned work to ${escapeHtml(toSection)}.`;
  if (!urls.length) return `<p>${sentence}</p>`;
  const linked = urls.map((url) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`).join(", ");
  return `<p>${sentence} Open changes still linked: ${linked}.</p>`;
}

async function loadSections(): Promise<Map<string, SectionRef>> {
  const rows = await prisma.$queryRaw<Array<{ id: number; projectId: number; title: string }>>`
    SELECT id, "projectId", "section_title" AS title
    FROM "Section"
    WHERE "projectId" IN (15, 4060) AND deleted = false
  `;
  return new Map(rows.map((row) => [`${row.projectId}:${row.title}`, row]));
}

async function countLiveRunners(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT a.id FROM "Agent" a
      WHERE a."revokedAt" IS NULL
        AND a."archivedAt" IS NULL
        AND a."heartbeatAt" >= now() - interval '45 minutes'
      UNION
      SELECT r."agentId" FROM "AgentRun" r
      WHERE r."agentId" IS NOT NULL
        AND r."lastActivityAt" >= now() - interval '45 minutes'
      UNION
      SELECT c."agentId" FROM "Comment" c
      WHERE c."agentId" IS NOT NULL
        AND c."createdAt" >= now() - interval '45 minutes'
    ) live
  `;
  return rows[0]?.n ?? 0;
}

async function releaseOne(
  row: AbandonedRow,
  board: BoardSpec,
  sections: Map<string, SectionRef>,
  nowMs: number,
): Promise<"released" | "kept"> {
  const outcome = await prisma.$transaction(async (tx) => {
    await lockAgentMutationFence(tx, row.id);
    const fresh = await rereadTask(tx, row.id);
    if (!fresh) return "kept" as const;
    const decision = decideAbandoned(fresh, nowMs, board);
    if (decision.action !== "release") return "kept" as const;
    const destination = sections.get(`${fresh.projectId}:${decision.toSection}`);
    if (!destination || destination.projectId !== fresh.projectId) return "kept" as const;
    const moved = await tx.task.updateMany({
      where: { id: fresh.id, section: board.inProgress, status: "Normal" },
      data: {
        section: decision.toSection,
        sectionId: destination.id,
        sectionChangedAt: new Date(nowMs),
        updatedAt: new Date(nowMs),
      },
    });
    if (moved.count !== 1) return "kept" as const;
    await tx.taskSectionEvent.create({
      data: {
        taskId: fresh.id,
        from: fresh.section,
        to: decision.toSection,
        userId: fresh.userId,
      },
    });
    await tx.assignees.deleteMany({
      where: { taskId: fresh.id, agentId: { not: null } },
    });
    const plain = releaseNote(decision.toSection, decision.pullRequestUrls);
    await tx.comment.create({
      data: {
        taskId: fresh.id,
        text: noteHtml(decision.toSection, decision.pullRequestUrls),
        commentText: plain,
        agentDisplayName: "Hypertask",
      },
    });
    return "released" as const;
  }, { timeout: 20_000 });
  return outcome;
}

async function postCapacityWarning(taskId: number, projectId: number, inProgress: number, liveRunners: number) {
  const plain = capacityWarning(projectId, inProgress, liveRunners);
  await prisma.comment.create({
    data: {
      taskId,
      text: "",
      commentText: plain,
      agentDisplayName: "Hypertask",
      activity: { type: "AiFeedbackLog", data: { text: plain } },
    },
  });
}

export async function sweepAbandonedWork(options: { dryRun?: boolean } = {}): Promise<SweepResult> {
  const enabled = await isFeatureEnabled(HTPR_8909_ABANDONED_WORK_FLAG, FEATURE_FLAG_OWNER_USER_ID);
  if (!enabled) return { enabled: false, liveRunners: 0, boards: [] };
  const nowMs = Date.now();
  const [sections, liveRunners] = await Promise.all([loadSections(), countLiveRunners()]);
  const boards: BoardSweepResult[] = [];
  const touched = new Set<number>();
  for (const board of BOARDS) {
    const raw = await readBoardOnce(board.projectId);
    const rows = raw.map(toRow);
    const recentAlerts = Number(raw[0]?.recentAlerts ?? 0);
    const plan = planBoard(rows, nowMs, board);
    const result: BoardSweepResult = {
      projectId: board.projectId,
      inProgress: rows.length,
      preview: plan.ok ? plan.releases.length : plan.preview,
      hand: plan.ok ? plan.releases.length : plan.hand,
      mismatch: !plan.ok,
      released: 0,
      kept: 0,
      failed: 0,
      capacityWarning: false,
      dryRun: options.dryRun === true,
    };
    const releasedIds = new Set<number>();
    if (plan.ok && !options.dryRun) {
      for (const release of plan.releases) {
        const row = rows.find((candidate) => candidate.id === release.id);
        if (!row) continue;
        try {
          const outcome = await releaseOne(row, board, sections, nowMs);
          if (outcome === "released") {
            result.released += 1;
            releasedIds.add(row.id);
            touched.add(row.id);
          } else {
            result.kept += 1;
          }
        } catch (error) {
          result.failed += 1;
          console.error("abandoned work release failed", row.id, error);
        }
      }
    }
    const remaining = rows.filter((row) => !releasedIds.has(row.id));
    const oldest = [...remaining].sort((left, right) => {
      const leftAt = Date.parse(left.sectionChangedAt ?? left.createdAt);
      const rightAt = Date.parse(right.sectionChangedAt ?? right.createdAt);
      return leftAt - rightAt;
    })[0];
    if (
      !options.dryRun &&
      oldest &&
      shouldPostCapacityWarning(remaining.length, liveRunners, recentAlerts)
    ) {
      await postCapacityWarning(oldest.id, board.projectId, remaining.length, liveRunners);
      result.capacityWarning = true;
      touched.add(oldest.id);
    }
    boards.push(result);
  }
  for (const projectId of new Set(boards.filter((board) => board.released > 0 || board.capacityWarning).map((board) => board.projectId))) {
    void broadcastBoardChange(projectId);
  }
  for (const taskId of touched) void broadcastTaskChange(taskId);
  return { enabled: true, liveRunners, boards };
}
