import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { lockAgentMutationFence } from "@/lib/mcp/tasks/agentMutationFence";
import { FEATURE_FLAG_OWNER_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_8909_ABANDONED_WORK_FLAG } from "@/lib/flags/definitions/htpr-8909-abandoned-work";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { BOARDS, capacityWarning, decideAbandoned, planBoard, releaseNote, shouldPostCapacityWarning, type AbandonedRow, type BoardSpec, type CommentFact } from "./policy";

const iso = "YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"";
type Raw = Record<string, unknown>;
function list<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}
function text(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}
function toRow(raw: Raw): AbandonedRow {
  return {
    id: Number(raw.id), projectId: Number(raw.projectId), section: String(raw.section ?? ""), status: String(raw.status ?? ""), userId: Number(raw.userId),
    sectionChangedAt: text(raw.sectionChangedAt), createdAt: text(raw.createdAt) ?? new Date(0).toISOString(),
    lastCommentAt: text(raw.lastCommentAt), lastRunAt: text(raw.lastRunAt), liveLeaseAt: text(raw.liveLeaseAt),
    assignees: list<{ userId: number; agentId: string | null; assignedAt: string }>(raw.assignees).map((assignee) => ({ userId: Number(assignee.userId), agentId: assignee.agentId ?? null, assignedAt: text(assignee.assignedAt) ?? new Date(0).toISOString() })),
    pullRequests: list<{ url: string; lifecycle: string; updatedAt: string | null }>(raw.pullRequests).map((pull) => ({ url: String(pull.url ?? ""), lifecycle: String(pull.lifecycle ?? ""), updatedAt: text(pull.updatedAt) })),
    comments: list<CommentFact>(raw.comments).map((comment) => ({
      id: Number(comment.id), createdAt: text(comment.createdAt) ?? new Date(0).toISOString(), text: String(comment.text ?? ""), commentText: String(comment.commentText ?? ""),
      creatorId: comment.creatorId == null ? null : Number(comment.creatorId), agentId: comment.agentId ?? null, agentDisplayName: comment.agentDisplayName ?? null, kind: comment.kind ?? null,
      reactions: list<{ emoji: string; at: string }>(comment.reactions).map((reaction) => ({ emoji: String(reaction.emoji ?? ""), at: text(reaction.at) ?? new Date(0).toISOString() })),
    })),
    sectionEvents: list<{ from: string; to: string; at: string }>(raw.sectionEvents).map((event) => ({ from: String(event.from ?? ""), to: String(event.to ?? ""), at: text(event.at) ?? new Date(0).toISOString() })),
    labels: list<string>(raw.labels).map((label) => String(label ?? "")).filter(Boolean),
  };
}
const snapshotSql = (taskFilter: Prisma.Sql) => Prisma.sql`
  SELECT t.id, t."projectId", t.section, t.status::text AS status, t."userId",
    to_char(t."sectionChangedAt" AT TIME ZONE 'UTC', ${iso}) AS "sectionChangedAt",
    to_char(t."createdAt" AT TIME ZONE 'UTC', ${iso}) AS "createdAt",
    (SELECT to_char(MAX(c."createdAt") AT TIME ZONE 'UTC', ${iso}) FROM "Comment" c WHERE c."taskId" = t.id AND c.activity IS NULL) AS "lastCommentAt",
    (SELECT to_char(MAX(r."lastActivityAt") AT TIME ZONE 'UTC', ${iso}) FROM "AgentRun" r WHERE r."taskId" = t.id) AS "lastRunAt",
    (SELECT to_char(MAX(l."heartbeatAt") AT TIME ZONE 'UTC', ${iso}) FROM "TaskLease" l WHERE l."taskId" = t.id AND l."expiresAt" > now()) AS "liveLeaseAt",
    COALESCE((SELECT json_agg(json_build_object('userId', a."userId", 'agentId', a."agentId", 'assignedAt', to_char(a."assignedAt" AT TIME ZONE 'UTC', ${iso}))) FROM "Assignees" a WHERE a."taskId" = t.id), '[]'::json) AS assignees,
    COALESCE((SELECT json_agg(json_build_object('url', p.url, 'lifecycle', p.lifecycle, 'updatedAt', to_char(p."updatedAt" AT TIME ZONE 'UTC', ${iso}))) FROM "TaskPullRequest" p WHERE p."taskId" = t.id), '[]'::json) AS "pullRequests",
    COALESCE((SELECT json_agg(json_build_object('id', c.id, 'createdAt', to_char(c."createdAt" AT TIME ZONE 'UTC', ${iso}), 'text', left(c.text, 12000), 'commentText', left(c."commentText", 12000), 'creatorId', c."creatorId", 'agentId', c."agentId", 'agentDisplayName', c."agentDisplayName", 'kind', c.kind, 'reactions', COALESCE((SELECT json_agg(json_build_object('emoji', reaction.emoji, 'at', to_char(COALESCE(reaction."updatedAt", reaction."createdAt") AT TIME ZONE 'UTC', ${iso}))) FROM "Reaction" reaction WHERE reaction."commentId" = c.id AND reaction."isDeleted" = false AND reaction."userId" = ${6} AND reaction."agentId" IS NULL), '[]'::json))) FROM "Comment" c WHERE c."taskId" = t.id AND c.activity IS NULL AND (c.kind = 'question' OR c.text ILIKE '%question:%' OR c."commentText" ILIKE '%question:%' OR (c."creatorId" = ${6} AND c."agentId" IS NULL AND c."agentDisplayName" IS NULL))), '[]'::json) AS comments,
    COALESCE((SELECT json_agg(json_build_object('from', event.from, 'to', event.to, 'at', to_char(event.timestamp AT TIME ZONE 'UTC', ${iso})) ORDER BY event.timestamp DESC) FROM (SELECT e.from, e.to, e.timestamp FROM "TaskSectionEvent" e WHERE e."taskId" = t.id ORDER BY e.timestamp DESC LIMIT 20) event), '[]'::json) AS "sectionEvents",
    COALESCE((SELECT json_agg(label.value) FROM "TaskLabel" task_label JOIN "Label" label ON label.id = task_label."labelId" WHERE task_label."taskId" = t.id AND label.value IS NOT NULL), '[]'::json) AS labels,
    (SELECT COUNT(*)::int FROM "Comment" alert JOIN "Task" alert_task ON alert_task.id = alert."taskId" WHERE alert_task."projectId" = t."projectId" AND alert."createdAt" > now() - interval '24 hours' AND alert."commentText" LIKE 'Abandoned work capacity:%') AS "recentAlerts"
  FROM "Task" t WHERE ${taskFilter}`;
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character] ?? character));
}
function noteHtml(toSection: string, urls: readonly string[]): string {
  const sentence = `Returned abandoned work to ${escapeHtml(toSection)}.`;
  if (!urls.length) return `<p>${sentence}</p>`;
  return `<p>${sentence} Open changes still linked: ${urls.map((url) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`).join(", ")}.</p>`;
}
async function releaseOne(row: AbandonedRow, board: BoardSpec, sections: Map<string, { id: number; projectId: number }>, nowMs: number) {
  return prisma.$transaction(async (tx) => {
    await lockAgentMutationFence(tx, row.id);
    const freshRows = await tx.$queryRaw<Raw[]>(snapshotSql(Prisma.sql`t.id = ${row.id}`));
    const fresh = freshRows[0] ? toRow(freshRows[0]) : null;
    if (!fresh) return "kept" as const;
    const decision = decideAbandoned(fresh, nowMs, board);
    const destination = decision.action === "release" ? sections.get(`${fresh.projectId}:${decision.toSection}`) : undefined;
    if (decision.action !== "release" || !destination || destination.projectId !== fresh.projectId) return "kept" as const;
    const moved = await tx.task.updateMany({
      where: { id: fresh.id, section: board.inProgress, status: "Normal" },
      data: { section: decision.toSection, sectionId: destination.id, sectionChangedAt: new Date(nowMs), updatedAt: new Date(nowMs) },
    });
    if (moved.count !== 1) return "kept" as const;
    await tx.taskSectionEvent.create({ data: { taskId: fresh.id, from: fresh.section, to: decision.toSection, userId: fresh.userId } });
    await tx.assignees.deleteMany({ where: { taskId: fresh.id, agentId: { not: null } } });
    await tx.comment.create({ data: { taskId: fresh.id, text: noteHtml(decision.toSection, decision.pullRequestUrls), commentText: releaseNote(decision.toSection, decision.pullRequestUrls), agentDisplayName: "Hypertask" } });
    return "released" as const;
  }, { timeout: 20_000 });
}
export async function sweepAbandonedWork(options: { dryRun?: boolean } = {}) {
  const enabled = await isFeatureEnabled(HTPR_8909_ABANDONED_WORK_FLAG, FEATURE_FLAG_OWNER_USER_ID);
  if (!enabled) return { enabled: false, liveRunners: 0, boards: [] };
  const nowMs = Date.now();
  const [sectionRows, runnerRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: number; projectId: number; title: string }>>`SELECT id, "projectId", "section_title" AS title FROM "Section" WHERE "projectId" IN (${Prisma.join(BOARDS.map((board) => board.projectId))}) AND deleted = false`,
    prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM (
      SELECT a.id FROM "Agent" a WHERE a."revokedAt" IS NULL AND a."archivedAt" IS NULL AND a."heartbeatAt" >= now() - interval '45 minutes'
      UNION SELECT r."agentId" FROM "AgentRun" r WHERE r."agentId" IS NOT NULL AND r."lastActivityAt" >= now() - interval '45 minutes'
      UNION SELECT c."agentId" FROM "Comment" c WHERE c."agentId" IS NOT NULL AND c."createdAt" >= now() - interval '45 minutes'
    ) live`,
  ]);
  const sections = new Map(sectionRows.map((row) => [`${row.projectId}:${row.title}`, row]));
  const liveRunners = runnerRows[0]?.n ?? 0;
  const boards = [];
  const touched = new Set<number>();
  for (const board of BOARDS) {
    const raw = await prisma.$queryRaw<Raw[]>(snapshotSql(Prisma.sql`t."projectId" = ${board.projectId} AND t.status = 'Normal' AND t.section = ${board.inProgress}`));
    const rows = raw.map(toRow);
    const plan = planBoard(rows, nowMs, board);
    const result = {
      projectId: board.projectId, inProgress: rows.length, preview: plan.ok ? plan.releases.length : plan.preview,
      hand: plan.ok ? plan.releases.length : plan.hand, mismatch: !plan.ok, released: 0, kept: 0, failed: 0,
      capacityWarning: false, dryRun: options.dryRun === true,
    };
    const releasedIds = new Set<number>();
    if (plan.ok && !options.dryRun) {
      for (const release of plan.releases) {
        const row = rows.find((candidate) => candidate.id === release.id);
        if (!row) continue;
        try {
          const outcome = await releaseOne(row, board, sections, nowMs);
          if (outcome === "released") { result.released += 1; releasedIds.add(row.id); touched.add(row.id); } else result.kept += 1;
        } catch (error) {
          result.failed += 1;
          console.error("abandoned work release failed", row.id, error);
        }
      }
    }
    const remaining = rows.length - releasedIds.size;
    const oldest = rows.filter((row) => !releasedIds.has(row.id)).sort((left, right) => Date.parse(left.sectionChangedAt ?? left.createdAt) - Date.parse(right.sectionChangedAt ?? right.createdAt))[0];
    if (!options.dryRun && oldest && shouldPostCapacityWarning(remaining, liveRunners, Number(raw[0]?.recentAlerts ?? 0))) {
      const plain = capacityWarning(board, remaining, liveRunners);
      await prisma.comment.create({ data: { taskId: oldest.id, text: "", commentText: plain, agentDisplayName: "Hypertask", activity: { type: "AiFeedbackLog", data: { text: plain } } } });
      result.capacityWarning = true;
      touched.add(oldest.id);
    }
    boards.push(result);
  }
  for (const projectId of new Set(boards.filter((board) => board.released > 0 || board.capacityWarning).map((board) => board.projectId))) void broadcastBoardChange(projectId);
  for (const taskId of touched) void broadcastTaskChange(taskId);
  return { enabled: true, liveRunners, boards };
}
