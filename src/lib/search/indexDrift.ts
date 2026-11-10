import {
  upsertAllCommentsToTurbopuffer,
  upsertTaskToTurbopuffer,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";
export type DriftPass = { date: string; found: number };
export type DriftState = { afterId: number; found: number; results: DriftPass[] };
export type DriftTask = { id: number; title: string; updatedAt: string; commentCount: number };
export type IndexedTaskTime = { updatedAt: string };
export type IndexedCommentCopy = { taskTitle: string; taskUpdatedAt: string };
export function emptyDriftState(): DriftState {
  return { afterId: 0, found: 0, results: [] };
}
function laterEdit(editedAt: string, indexedAt: string | null): boolean {
  if (!indexedAt) return true;
  const edited = Date.parse(editedAt);
  const indexed = Date.parse(indexedAt);
  if (!Number.isFinite(edited) || !Number.isFinite(indexed)) return true;
  return edited > indexed;
}
export function taskRowDrifted(task: { updatedAt: string }, indexed: IndexedTaskTime | null): boolean {
  return !indexed || laterEdit(task.updatedAt, indexed.updatedAt);
}
export function commentCopyDrifted(task: DriftTask, indexed: IndexedCommentCopy | null): boolean {
  if (task.commentCount === 0) return false;
  if (!indexed || indexed.taskTitle !== task.title) return true;
  return laterEdit(task.updatedAt, indexed.taskUpdatedAt);
}
export function commentsFollowTaskEdit(args: {
  titleChanged: boolean; status?: unknown; ticketNumber?: unknown; uniqueIndex?: unknown; projectId?: unknown;
}): boolean {
  return Boolean(args.titleChanged || args.status || args.ticketNumber || args.uniqueIndex || args.projectId);
}

export async function syncTaskEditSearchIndex(args: {
  taskId: number; titleChanged: boolean; status?: unknown; ticketNumber?: unknown;
  uniqueIndex?: unknown; projectId?: unknown;
  upsertTask?: (taskId: number) => Promise<unknown>;
  upsertComments?: (taskId: number) => Promise<unknown>;
}): Promise<void> {
  await (args.upsertTask ?? upsertTaskToTurbopuffer)(args.taskId);
  if (commentsFollowTaskEdit(args)) await (args.upsertComments ?? upsertAllCommentsToTurbopuffer)(args.taskId);
}

export function recordDriftPass(results: DriftPass[], date: string, found: number): DriftPass[] {
  return [...results.filter((pass) => pass.date !== date), { date, found }].slice(-8);
}

export async function advanceIndexDrift(args: {
  tasks: DriftTask[]; indexedTasks: Map<number, IndexedTaskTime | null>;
  indexedComments: Map<number, IndexedCommentCopy | null>; batchFull: boolean; maxReindex: number;
  state: DriftState; reindexTask: (taskId: number) => Promise<unknown>;
  reindexComments: (taskId: number) => Promise<unknown>;
}): Promise<{ state: DriftState; reindexed: number; passComplete: boolean; stopped: boolean; passFound: number | null }> {
  const state = { afterId: args.state.afterId, found: args.state.found, results: args.state.results };
  let reindexed = 0;
  if (args.tasks.length === 0) {
    return { state, reindexed, passComplete: true, stopped: false, passFound: state.found };
  }
  for (const task of args.tasks) {
    const taskDrift = taskRowDrifted(task, args.indexedTasks.get(task.id) ?? null);
    const commentDrift = commentCopyDrifted(task, args.indexedComments.get(task.id) ?? null);
    const drifted = taskDrift || commentDrift;
    if (drifted && reindexed >= args.maxReindex) {
      return { state, reindexed, passComplete: false, stopped: true, passFound: null };
    }
    try {
      if (taskDrift) {
        await args.reindexTask(task.id);
        reindexed += 1;
      }
      if (commentDrift) {
        await args.reindexComments(task.id);
        reindexed += 1;
      }
    } catch {
      return { state, reindexed, passComplete: false, stopped: true, passFound: null };
    }
    if (drifted) state.found += 1;
    state.afterId = task.id;
  }
  const passComplete = !args.batchFull;
  return { state, reindexed, passComplete, stopped: false, passFound: passComplete ? state.found : null };
}
