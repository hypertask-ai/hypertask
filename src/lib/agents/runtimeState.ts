import { getRedis } from "../redis";

export const RUNTIME_SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const RUNTIME_HEARTBEAT_SECONDS = 30;
export const MIN_STALL_MS = 5 * 60 * 1000;
export const MAX_RUNTIME_QUEUE_ITEMS = 50;
export const MAX_RUNTIME_SEQUENCE_ADVANCE = 1_000;

export type AgentRuntimeQueueItem = {
  ticket: string;
  title: string;
  url: string;
  boardId: number;
  boardName: string;
  section: string;
  state: "running" | "waiting" | "pending";
  reason: "direct_mention" | "assignment" | "discovery" | "other";
  priority: string | null;
  dueAt: string | null;
  startedAt: string | null;
};

export type AgentRuntimeSnapshot = {
  version: 1;
  sequence: number;
  workerId: string;
  runtime: string;
  model: string | null;
  heartbeatAt: string;
  lastProgressAt: string | null;
  cadenceSeconds: number;
  sourceSections: Array<{ boardId: number; section: string }>;
  // Label-scoped agents only discover unassigned work carrying this label, so
  // the pool shown on the agent page has to narrow the same way.
  scopeLabel?: string | null;
  processedTickets: Array<{ boardId: number; ticket: string }>;
  queue: AgentRuntimeQueueItem[];
};

export type AgentRuntimeHealth =
  | "working"
  | "connected"
  | "waiting"
  | "stalled"
  | "offline";

const runtimeKey = (agentId: string) => `agent:runtime:v1:${agentId}`;
const runtimeSequenceKey = (agentId: string) =>
  `agent:runtime-sequence:v1:${agentId}`;

type StoredAgentRuntimeSnapshot = {
  generation: number;
  sequence: number;
  snapshot: AgentRuntimeSnapshot;
};

export type AgentRuntimeSaveResult =
  | { status: "saved" }
  | { status: "stale"; nextSequence: number }
  | { status: "reset_required"; nextSequence: number };

export function stallThresholdMs(cadenceSeconds: number): number {
  return Math.max(MIN_STALL_MS, cadenceSeconds * 3 * 1000);
}

export function classifyRuntimeHealth(
  snapshot: AgentRuntimeSnapshot | null,
  now = Date.now(),
): AgentRuntimeHealth {
  if (!snapshot) return "offline";
  const threshold = stallThresholdMs(snapshot.cadenceSeconds);
  const heartbeatAge = now - new Date(snapshot.heartbeatAt).getTime();
  if (!Number.isFinite(heartbeatAge) || heartbeatAge > threshold)
    return "offline";

  const active = snapshot.queue.find((item) =>
    ["running", "waiting"].includes(item.state),
  );
  if (!active) return "connected";
  if (active.state === "waiting") return "waiting";
  const progressAt = snapshot.lastProgressAt ?? active.startedAt;
  const progressAge = progressAt
    ? now - new Date(progressAt).getTime()
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(progressAge) || progressAge > threshold)
    return "stalled";
  return "working";
}

export function filterRuntimeSnapshotToBoards(
  snapshot: AgentRuntimeSnapshot | null,
  boardIds: ReadonlySet<number>,
): AgentRuntimeSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    queue: snapshot.queue.filter((item) => boardIds.has(item.boardId)),
    sourceSections: snapshot.sourceSections?.filter((item) =>
      boardIds.has(item.boardId),
    ) ?? [],
    processedTickets: snapshot.processedTickets?.filter((item) =>
      boardIds.has(item.boardId),
    ) ?? [],
  };
}

export function selectAgentOperationsQueue(input: {
  snapshot: AgentRuntimeSnapshot | null;
  inferredQueue: AgentRuntimeQueueItem[];
  health: AgentRuntimeHealth;
  enabled: boolean;
}): {
  source: "runtime" | "inferred";
  queue: AgentRuntimeQueueItem[];
} {
  if (input.enabled && input.snapshot && input.health !== "offline") {
    return { source: "runtime", queue: input.snapshot.queue };
  }
  return { source: "inferred", queue: input.inferredQueue };
}

export async function saveAgentRuntimeSnapshot(
  agentId: string,
  generation: number,
  snapshot: AgentRuntimeSnapshot,
): Promise<AgentRuntimeSaveResult> {
  const redis = await getRedis();
  const stored: StoredAgentRuntimeSnapshot = {
    generation,
    sequence: snapshot.sequence,
    snapshot,
  };
  const result = await redis.eval(
    `local current = redis.call('GET', KEYS[2])
     local incoming_generation = tonumber(ARGV[1])
     local incoming_sequence = tonumber(ARGV[2])
     if current then
       local ok, decoded = pcall(cjson.decode, current)
       if ok then
         local current_generation = tonumber(decoded.generation)
         if current_generation > incoming_generation or
            (current_generation == incoming_generation and
             tonumber(decoded.sequence) >= incoming_sequence) then
           return {0, tonumber(decoded.sequence) + 1}
         end
         if current_generation == incoming_generation and
            incoming_sequence > tonumber(decoded.sequence) + tonumber(ARGV[5]) then
           return {-1, tonumber(decoded.sequence) + 1}
         end
         if current_generation < incoming_generation and
            incoming_sequence > tonumber(ARGV[5]) then
           return {-1, 1}
         end
       end
     elseif incoming_sequence > tonumber(ARGV[5]) then
       return {-1, 1}
     end
     redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
     redis.call('SET', KEYS[2], ARGV[6])
     return {1, incoming_sequence + 1}`,
    2,
    runtimeKey(agentId),
    runtimeSequenceKey(agentId),
    String(generation),
    String(snapshot.sequence),
    JSON.stringify(stored),
    String(RUNTIME_SNAPSHOT_TTL_SECONDS),
    String(MAX_RUNTIME_SEQUENCE_ADVANCE),
    JSON.stringify({ generation, sequence: snapshot.sequence }),
  );
  if (!Array.isArray(result)) {
    throw new Error("Redis returned an invalid runtime sequence result");
  }
  const [rawStatus, rawNextSequence] = result;
  const status = Number(rawStatus);
  const nextSequence = Number(rawNextSequence);
  if (status === 1) return { status: "saved" };
  if (
    status === 0 &&
    Number.isSafeInteger(nextSequence) &&
    nextSequence > 0
  ) {
    return { status: "stale", nextSequence };
  }
  if (
    status === -1 &&
    Number.isSafeInteger(nextSequence) &&
    nextSequence > 0
  ) {
    return { status: "reset_required", nextSequence };
  }
  throw new Error("Redis returned an invalid runtime sequence result");
}

export async function clearAgentRuntimeSnapshot(agentId: string): Promise<void> {
  const redis = await getRedis();
  await redis.del(runtimeKey(agentId));
}

export async function readAgentRuntimeSnapshot(
  agentId: string,
  expectedGeneration: number,
): Promise<AgentRuntimeSnapshot | null> {
  try {
    const redis = await getRedis();
    const raw = await redis.get(runtimeKey(agentId));
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredAgentRuntimeSnapshot;
    if (
      value.generation !== expectedGeneration ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 1 ||
      value.snapshot?.version !== 1 ||
      !Array.isArray(value.snapshot.queue)
    ) {
      return null;
    }
    return value.snapshot;
  } catch (error) {
    console.warn("[Agent runtime] Snapshot read failed:", error);
    return null;
  }
}
