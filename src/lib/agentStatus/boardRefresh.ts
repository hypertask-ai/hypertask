import { featureFlagCandidateUserIds } from "@/lib/flags";
import { HTPR_7071_AGENT_STATUS_CHIP_FLAG } from "@/lib/flags/keys";
import { broadcastBoardChange } from "@/lib/realtime/server";

// HTPR-7071: board cards show the agent's last report, so agent runs refresh the
// board through the existing channel.
const BOARD_ACTIVITY_BROADCAST_WINDOW_MS = 15_000;
const MAX_TRACKED_CARDS = 500;
const lastBoardActivityBroadcast = new Map<string, number>();

// Activity-only updates move just the timestamp, so they are throttled once per card
// per window. Keyed per card, a busy card never starves another card's first report.
// A dropped report leaves only that card stale by at most one window, because its
// previous broadcast is at most one window old. No trailing timer: serverless
// functions may freeze before it fires.
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
  candidateUserIds: (key: string) => Promise<number[] | null>;
  broadcast: (projectId: number, options: { originUserId: number }) => Promise<unknown>;
  shouldBroadcast: (projectId: number, taskId: number) => boolean;
};

const defaultDeps: BoardRefreshDeps = {
  candidateUserIds: featureFlagCandidateUserIds,
  broadcast: broadcastBoardChange,
  shouldBroadcast: shouldBroadcastBoardActivity,
};

/**
 * Refresh a board for every viewer when the chip flag is not fully OFF. The payload
 * stays gated per viewer in getBoardTasks; this is one cached mode lookup, not a
 * per-viewer loop. Run start and stop (`lifecycle`) decide whether a chip appears, so
 * they are never throttled; activity updates are.
 */
export async function refreshBoardForAgentRun(
  projectId: number,
  originUserId: number,
  options: { lifecycle: boolean; taskId?: number },
  deps: BoardRefreshDeps = defaultDeps,
): Promise<boolean> {
  if (!options.lifecycle && !deps.shouldBroadcast(projectId, options.taskId ?? 0)) return false;
  const candidates = await deps.candidateUserIds(HTPR_7071_AGENT_STATUS_CHIP_FLAG);
  if (candidates !== null && candidates.length === 0) return false;
  await deps.broadcast(projectId, { originUserId });
  return true;
}
