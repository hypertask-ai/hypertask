import { Prisma, Status } from "@prisma/client";

import prisma from "@/lib/prisma";
import turbopuffer, { turbopufferNamespaces } from "@/lib/turbopuffer";
import {
  advanceIndexDrift,
  emptyDriftState,
  recordDriftPass,
  type DriftState,
  type DriftTask,
  type IndexedCommentCopy,
  type IndexedTaskTime,
} from "@/lib/search/indexDrift";
import {
  buildTurbopufferCommentRow,
  buildTurbopufferTaskRow,
  turbopufferCommentInclude,
  turbopufferTaskInclude,
  upsertCommentRowsToTurbopuffer,
  upsertTaskRowsToTurbopuffer,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";

export const DRIFT_SCAN_BATCH = 50;
export const DRIFT_MAX_BATCHES = 8;
export const DRIFT_MAX_REINDEX = 100;
export const DRIFT_STATE_KEY = "search-index-drift:htpr-9016";

type DriftDeps = {
  loadPage: (afterId: number, take: number) => Promise<{
    tasks: DriftTask[];
    indexedTasks: Map<number, IndexedTaskTime | null>;
    indexedComments: Map<number, IndexedCommentCopy | null>;
    batchFull: boolean;
  }>;
  reindexTask: (taskId: number) => Promise<void>;
  reindexComments: (taskId: number) => Promise<void>;
  today: () => string;
};

function textAttr(row: { [key: string]: unknown } | undefined, key: string) {
  const value = row?.[key];
  return value == null ? "" : String(value);
}

function rowId(row: { id?: unknown }) {
  const id = Number(row.id);
  return Number.isInteger(id) ? id : null;
}

export async function loadIndexDriftPage(afterId: number, take: number) {
  const rows = await prisma.task.findMany({
    where: { id: { gt: afterId }, status: { not: Status.Deleted } },
    orderBy: { id: "asc" },
    take,
    select: { id: true, title: true, updatedAt: true },
  });
  const ids = rows.map((row) => row.id);
  const commentGroups = ids.length
    ? await prisma.comment.groupBy({
        by: ["taskId"],
        where: {
          taskId: { in: ids },
          activity: { equals: Prisma.DbNull },
        },
        _count: { _all: true },
      })
    : [];
  const commentCounts = new Map(
    commentGroups.map((group) => [group.taskId, group._count._all]),
  );
  const tasks: DriftTask[] = rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    updatedAt: row.updatedAt.toISOString(),
    commentCount: commentCounts.get(row.id) ?? 0,
  }));
  const indexedTasks = await readIndexedTasks(tasks.map((task) => String(task.id)));
  const indexedComments = await readIndexedComments(
    tasks.filter((task) => task.commentCount > 0).map((task) => String(task.id)),
  );
  return { tasks, indexedTasks, indexedComments, batchFull: rows.length === take };
}

async function readIndexedTasks(ids: string[]) {
  const indexed = new Map<number, IndexedTaskTime | null>();
  if (ids.length === 0) return indexed;
  const response = await turbopuffer.namespace(turbopufferNamespaces.task.name).query({
    filters: ["id", "In", ids],
    rank_by: ["id", "asc"],
    top_k: ids.length,
    include_attributes: ["updatedAt"],
    consistency: { level: "strong" },
  } as any);
  for (const id of ids) indexed.set(Number(id), null);
  for (const row of response.rows ?? []) {
    const id = rowId(row);
    if (id == null) continue;
    indexed.set(id, { updatedAt: textAttr(row as { [key: string]: unknown }, "updatedAt") });
  }
  return indexed;
}

async function readIndexedComments(ids: string[]) {
  const indexed = new Map<number, IndexedCommentCopy | null>();
  const pending = [...ids];
  const workers = Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id) return;
      const response = await turbopuffer.namespace(turbopufferNamespaces.comment.name).query({
        filters: ["taskId", "Eq", id],
        rank_by: ["createdAt", "desc"],
        top_k: 1,
        include_attributes: ["taskTitle", "taskUpdatedAt"],
        consistency: { level: "strong" },
      } as any);
      const row = response.rows?.[0] as { [key: string]: unknown } | undefined;
      indexed.set(
        Number(id),
        row
          ? {
              taskTitle: textAttr(row, "taskTitle"),
              taskUpdatedAt: textAttr(row, "taskUpdatedAt"),
            }
          : null,
      );
    }
  });
  await Promise.all(workers);
  return indexed;
}

export async function reindexDriftedTask(taskId: number) {
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    include: turbopufferTaskInclude,
  });
  if (!task || task.status === Status.Deleted) return;
  await upsertTaskRowsToTurbopuffer([buildTurbopufferTaskRow(task)]);
}

export async function reindexDriftedComments(taskId: number) {
  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: turbopufferCommentInclude,
  });
  const rows = comments
    .map((comment) => buildTurbopufferCommentRow(comment))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (rows.length === 0) return;
  await upsertCommentRowsToTurbopuffer(rows);
}

export async function runIndexDriftRepair(
  state: DriftState = emptyDriftState(),
  deps: DriftDeps = {
    loadPage: loadIndexDriftPage,
    reindexTask: reindexDriftedTask,
    reindexComments: reindexDriftedComments,
    today: () => new Date().toISOString().slice(0, 10),
  },
) {
  let current = {
    afterId: state.afterId,
    found: state.found,
    results: state.results ?? [],
  };
  let scanned = 0;
  let reindexed = 0;
  let passComplete = false;
  let passFound: number | null = null;

  for (let batch = 0; batch < DRIFT_MAX_BATCHES && reindexed < DRIFT_MAX_REINDEX; batch += 1) {
    const page = await deps.loadPage(current.afterId, DRIFT_SCAN_BATCH);
    scanned += page.tasks.length;
    const outcome = await advanceIndexDrift({
      tasks: page.tasks,
      indexedTasks: page.indexedTasks,
      indexedComments: page.indexedComments,
      batchFull: page.batchFull,
      maxReindex: DRIFT_MAX_REINDEX - reindexed,
      state: current,
      reindexTask: deps.reindexTask,
      reindexComments: deps.reindexComments,
    });
    current = outcome.state;
    reindexed += outcome.reindexed;
    if (outcome.passComplete && outcome.passFound != null) {
      passComplete = true;
      passFound = outcome.passFound;
      current = {
        afterId: 0,
        found: 0,
        results: recordDriftPass(current.results, deps.today(), outcome.passFound),
      };
      break;
    }
    if (outcome.stopped || page.tasks.length === 0) break;
  }

  return { state: current, scanned, reindexed, passComplete, passFound };
}
