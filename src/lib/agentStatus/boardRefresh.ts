import { featureFlagCandidateUserIds } from "@/lib/flags";
import { HTPR_7071_AGENT_STATUS_CHIP_FLAG } from "@/lib/flags/keys";
import { broadcastBoardChange } from "@/lib/realtime/server";

// HTPR-7071: board cards show the agent's last report, so agent runs refresh the
// board through the existing channel.
const BOARD_ACTIVITY_BROADCAST_WINDOW_MS = 15_000;
const lastBoardActivityBroadcast = new Map<number, number>();

// Activity-only updates move just the timestamp, so they are throttled to once per
// board per window. A dropped one leaves the time at most one window stale; there is
// no trailing timer because serverless functions may freeze before it fires.
export function shouldBroadcastBoardActivity(
  projectId: number,
  now: number = Date.now(),
  last: Map<number, number> = lastBoardActivityBroadcast,
): boolean {
  const previous = last.get(projectId);
  if (previous !== undefined && now - previous < BOARD_ACTIVITY_BROADCAST_WINDOW_MS) return false;
  last.set(projectId, now);
  return true;
}

type BoardRefreshDeps = {
  candidateUserIds: (key: string) => Promise<number[] | null>;
  broadcast: (projectId: number, options: { originUserId: number }) => Promise<unknown>;
  shouldBroadcast: (projectId: number) => boolean;
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
  options: { lifecycle: boolean },
  deps: BoardRefreshDeps = defaultDeps,
): Promise<boolean> {
  if (!options.lifecycle && !deps.shouldBroadcast(projectId)) return false;
  const candidates = await deps.candidateUserIds(HTPR_7071_AGENT_STATUS_CHIP_FLAG);
  if (candidates !== null && candidates.length === 0) return false;
  await deps.broadcast(projectId, { originUserId });
  return true;
}
