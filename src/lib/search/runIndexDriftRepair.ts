import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import turbopuffer, { turbopufferNamespaces } from "@/lib/turbopuffer";
import {
  advanceIndexDrift,
  emptyDriftState,
  recordDriftPass,
  type DriftFailure,
  type DriftState,
  type DriftTask,
  type IndexedCommentCopy,
  type IndexedTaskTime,
} from "@/lib/search/indexDrift";
import {
  upsertAllCommentsToTurbopuffer,
  upsertTaskToTurbopuffer,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";

export const DRIFT_SCAN_BATCH = 50;
export const DRIFT_PAGE_CAP = 400;
export const DRIFT_MAX_REINDEX = 100;
export const DRIFT_MAX_FAILURES = 20;
export const DRIFT_TIME_BUDGET_MS = 250_000;
export const DRIFT_STATE_KEY = "search-index-drift:htpr-9016";

type Page = {
  tasks: DriftTask[];
  indexedTasks: Map<number, IndexedTaskTime | null>;
  indexedComments: Map<number, IndexedCommentCopy | null>;
  batchFull: boolean;
};

type DriftDeps = {
  loadPage: (afterId: number, take: number) => Promise<Page>;
  reindexTask: (taskId: number) => Promise<unknown>;
  reindexComments: (taskId: number) => Promise<unknown>;
  today: () => string;
  now?: () => number;
};

function textAttr(row: { [key: string]: unknown } | undefined, key: string) {
  const value = row?.[key];
  return value == null ? "" : String(value);
}

async function queryRows(name: string, body: Record<string, unknown>) {
  const response = await turbopuffer.namespace(name).query(body as any);
  return (response.rows ?? []) as { id?: unknown; [key: string]: unknown }[];
}

export async function loadIndexDriftPage(afterId: number, take: number): Promise<Page> {
  const rows = await prisma.task.findMany({
    where: { id: { gt: afterId } },
    orderBy: { id: "asc" },
    take,
    select: {
      id: true, title: true, updatedAt: true,
      status: true, ticketNumber: true, uniqueIndex: true, projectId: true,
    },
  });
  const ids = rows.map((row) => row.id);
  const groups = ids.length
    ? await prisma.comment.groupBy({
        by: ["taskId"],
        where: { taskId: { in: ids }, activity: { equals: Prisma.DbNull } },
        _count: { _all: true },
      })
    : [];
  const counts = new Map(groups.map((group) => [group.taskId, group._count._all]));
  const tasks: DriftTask[] = rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    updatedAt: row.updatedAt?.toISOString() ?? "",
    commentCount: counts.get(row.id) ?? 0,
    status: row.status ?? "",
    ticketNumber: row.ticketNumber ?? "",
    uniqueIndex: row.uniqueIndex == null ? "" : String(row.uniqueIndex),
    projectId: row.projectId == null ? "" : String(row.projectId),
  }));
  const indexedTasks = new Map<number, IndexedTaskTime | null>();
  const taskIds = tasks.map((task) => String(task.id));
  if (taskIds.length) {
    for (const id of taskIds) indexedTasks.set(Number(id), null);
    for (const row of await queryRows(turbopufferNamespaces.task.name, {
      filters: ["id", "In", taskIds],
      rank_by: ["id", "asc"],
      top_k: taskIds.length,
      include_attributes: ["updatedAt"],
      consistency: { level: "strong" },
    })) {
      const id = Number(row.id);
      if (!Number.isInteger(id)) continue;
      indexedTasks.set(id, { updatedAt: textAttr(row, "updatedAt") });
    }
  }
  const indexedComments = new Map<number, IndexedCommentCopy | null>();
  for (const task of tasks) {
    if (task.commentCount === 0) continue;
    const [row] = await queryRows(turbopufferNamespaces.comment.name, {
      filters: ["taskId", "Eq", String(task.id)],
      rank_by: ["taskUpdatedAt", "asc"],
      top_k: 1,
      include_attributes: ["taskTitle", "taskStatus", "taskTicketNumber", "taskUniqueIndex", "taskProjectId"],
      consistency: { level: "strong" },
    });
    indexedComments.set(task.id, row
      ? {
          taskTitle: textAttr(row, "taskTitle"),
          taskStatus: textAttr(row, "taskStatus"),
          taskTicketNumber: textAttr(row, "taskTicketNumber"),
          taskUniqueIndex: textAttr(row, "taskUniqueIndex"),
          taskProjectId: textAttr(row, "taskProjectId"),
        }
      : null);
  }
  return { tasks, indexedTasks, indexedComments, batchFull: rows.length === take };
}

export async function runIndexDriftRepair(
  state: DriftState = emptyDriftState(),
  deps: DriftDeps = {
    loadPage: loadIndexDriftPage,
    reindexTask: (taskId) => upsertTaskToTurbopuffer(taskId, { strict: true }),
    reindexComments: (taskId) => upsertAllCommentsToTurbopuffer(taskId, { strict: true }),
    today: () => new Date().toISOString().slice(0, 10),
    now: () => Date.now(),
  },
) {
  const clock = deps.now ?? (() => Date.now());
  const deadline = clock() + DRIFT_TIME_BUDGET_MS;
  let current = { afterId: state.afterId, found: state.found, results: state.results ?? [] };
  let scanned = 0;
  let reindexed = 0;
  const failed: DriftFailure[] = [];
  for (let batch = 0; batch < DRIFT_PAGE_CAP && clock() < deadline && reindexed < DRIFT_MAX_REINDEX; batch += 1) {
    const page = await deps.loadPage(current.afterId, DRIFT_SCAN_BATCH);
    scanned += page.tasks.length;
    const outcome = await advanceIndexDrift({
      tasks: page.tasks,
      indexedTasks: page.indexedTasks,
      indexedComments: page.indexedComments,
      batchFull: page.batchFull,
      maxReindex: DRIFT_MAX_REINDEX - reindexed,
      maxFailures: DRIFT_MAX_FAILURES - failed.length,
      state: current,
      reindexTask: deps.reindexTask,
      reindexComments: deps.reindexComments,
    });
    current = outcome.state;
    reindexed += outcome.reindexed;
    failed.push(...outcome.failed);
    if (failed.length >= DRIFT_MAX_FAILURES) break;
    if (outcome.passComplete && outcome.passFound != null) {
      return {
        state: {
          afterId: 0,
          found: 0,
          results: recordDriftPass(current.results, deps.today(), outcome.passFound),
        },
        scanned,
        reindexed,
        passComplete: true,
        passFound: outcome.passFound,
        failed,
      };
    }
    if (outcome.stopped || page.tasks.length === 0) break;
  }
  return { state: current, scanned, reindexed, passComplete: false, passFound: null, failed };
}
