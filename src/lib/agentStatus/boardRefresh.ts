import { broadcastBoardChange } from "@/lib/realtime/server";

const BOARD_ACTIVITY_BROADCAST_WINDOW_MS = 15_000;
const MAX_TRACKED_CARDS = 500;
const lastBoardActivityBroadcast = new Map<string, number>();

export function shouldBroadcastBoardActivity(
  projectId: number,
  taskId: number,
  now: number = Date.now(),
  last: Map<string, number> = lastBoardActivityBroadcast,
): boolean {
  const key = `${projectId}:${taskId}`;
  const previous = last.get(key);
  if (previous !== undefined && now - previous < BOARD_ACTIVITY_BROADCAST_WINDOW_MS) return false;
  if (last.size >= MAX_TRACKED_CARDS) {
    for (const [entryKey, at] of last) {
      if (now - at >= BOARD_ACTIVITY_BROADCAST_WINDOW_MS) last.delete(entryKey);
    }
  }
  last.set(key, now);
  return true;
}

type BoardRefreshDeps = {
  broadcast: (projectId: number, options: { originUserId: number }) => Promise<unknown>;
  shouldBroadcast: (projectId: number, taskId: number) => boolean;
};

const defaultDeps: BoardRefreshDeps = {
  broadcast: broadcastBoardChange,
  shouldBroadcast: shouldBroadcastBoardActivity,
};

export async function refreshBoardForAgentRun(
  projectId: number,
  originUserId: number,
  options: { lifecycle: boolean; taskId?: number },
  deps: BoardRefreshDeps = defaultDeps,
): Promise<boolean> {
  if (!options.lifecycle && !deps.shouldBroadcast(projectId, options.taskId ?? 0)) return false;
  await deps.broadcast(projectId, { originUserId });
  return true;
}
