import { createHash } from "crypto";
import { getRedis } from "@/lib/redis";

const EXECUTION_KEY_PREFIX = "native-agent-heartbeat:execution:v1:";
const EXECUTION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type HeartbeatExecutionStatus =
  | "reserved"
  | "running"
  | "completed"
  | "failed"
  | "uncertain"
  | "needs_reconciliation";

export type HeartbeatExecutionState = {
  version: 1;
  executionId: string;
  agentId: string;
  userId: number;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  claimedAt: string;
  previousHeartbeatAt: string | null;
  status: HeartbeatExecutionStatus;
  mutationStarted: boolean;
  notificationDelivered: boolean;
  createdAt: string;
  updatedAt: string;
  failure?: string;
};

export type HeartbeatRecoveryDecision =
  "deliver" | "restore" | "wait" | "block" | "advance";

export type HeartbeatRecoveryOutcome =
  | "clear"
  | "pending"
  | "restored"
  | "delivered"
  | "reconciled";

export const heartbeatRecoveryAllowsNewClaim = (
  outcome: HeartbeatRecoveryOutcome,
) => outcome === "clear" || outcome === "reconciled";

export const decideHeartbeatRecovery = ({
  status,
  mutationStarted,
  notificationDelivered,
  replyExists,
  stale,
}: Pick<
  HeartbeatExecutionState,
  "status" | "mutationStarted" | "notificationDelivered"
> & {
  replyExists: boolean;
  stale: boolean;
}): HeartbeatRecoveryDecision => {
  if (replyExists) {
    return status === "completed" && notificationDelivered
      ? "advance"
      : "deliver";
  }
  if (status === "needs_reconciliation" && notificationDelivered) {
    return "advance";
  }
  if (status === "reserved") return stale ? "restore" : "wait";
  if (status === "failed" && !mutationStarted) return "restore";
  if (status === "running" && !stale) return "wait";
  if (status === "running" && !mutationStarted) return "restore";
  return "block";
};

type ExecutionIdentity = Pick<
  HeartbeatExecutionState,
  | "executionId"
  | "agentId"
  | "userId"
  | "sessionId"
  | "userMessageId"
  | "assistantMessageId"
  | "claimedAt"
>;

type StoredExecution = {
  raw: string;
  state: HeartbeatExecutionState;
};

const executionKey = (executionId: string) =>
  `${EXECUTION_KEY_PREFIX}${executionId}`;

const deterministicUuid = (scope: string): string => {
  const bytes = createHash("sha256").update(scope).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Identifies the "team allowance is spent" inbox notice for one agent in one
 * allowance period, so the owner is told once rather than on every cron tick.
 * A UUID because decodeAgentMessage slices the marker at a fixed 36 characters.
 */
export const heartbeatAllowanceNoticeId = (
  agentId: string,
  periodKey: string,
) =>
  deterministicUuid(
    `hypertask:native-agent-allowance:${agentId}:${periodKey}`,
  );

export const heartbeatExecutionIds = (agentId: string, claimedAt: Date) => {
  const executionId = deterministicUuid(
    `hypertask:native-agent-heartbeat:${agentId}:${claimedAt.toISOString()}`,
  );
  return {
    executionId,
    userMessageId: deterministicUuid(`${executionId}:user`),
    assistantMessageId: deterministicUuid(`${executionId}:assistant`),
  };
};

const isExecutionState = (value: unknown): value is HeartbeatExecutionState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<HeartbeatExecutionState>;
  return (
    state.version === 1 &&
    typeof state.executionId === "string" &&
    typeof state.agentId === "string" &&
    Number.isInteger(state.userId) &&
    typeof state.sessionId === "string" &&
    typeof state.userMessageId === "string" &&
    typeof state.assistantMessageId === "string" &&
    typeof state.claimedAt === "string" &&
    (state.previousHeartbeatAt === null ||
      typeof state.previousHeartbeatAt === "string") &&
    [
      "reserved",
      "running",
      "completed",
      "failed",
      "uncertain",
      "needs_reconciliation",
    ].includes(state.status ?? "") &&
    typeof state.mutationStarted === "boolean" &&
    typeof state.notificationDelivered === "boolean" &&
    typeof state.createdAt === "string" &&
    typeof state.updatedAt === "string"
  );
};

const parseStoredExecution = (raw: string | null): StoredExecution | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isExecutionState(value) ? { raw, state: value } : null;
  } catch {
    return null;
  }
};

const getStoredExecution = async (
  executionId: string,
): Promise<StoredExecution | null> => {
  const redis = await getRedis();
  return parseStoredExecution(await redis.get(executionKey(executionId)));
};

export const getHeartbeatExecution = async (
  executionId: string,
): Promise<HeartbeatExecutionState | null> =>
  (await getStoredExecution(executionId))?.state ?? null;

const compareAndSet = async (
  executionId: string,
  expectedRaw: string,
  next: HeartbeatExecutionState,
): Promise<boolean> => {
  const redis = await getRedis();
  const result = await redis.eval(
    `
      local current = redis.call("GET", KEYS[1])
      if current ~= ARGV[1] then return 0 end
      redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
      return 1
    `,
    1,
    executionKey(executionId),
    expectedRaw,
    JSON.stringify(next),
    String(EXECUTION_TTL_SECONDS),
  );
  return Number(result) === 1;
};

const sameIdentity = (
  state: HeartbeatExecutionState,
  identity: ExecutionIdentity,
) =>
  state.executionId === identity.executionId &&
  state.agentId === identity.agentId &&
  state.userId === identity.userId &&
  state.sessionId === identity.sessionId &&
  state.userMessageId === identity.userMessageId &&
  state.assistantMessageId === identity.assistantMessageId &&
  state.claimedAt === identity.claimedAt;

export const reserveHeartbeatExecution = async (
  input: ExecutionIdentity & { previousHeartbeatAt: string | null },
): Promise<HeartbeatExecutionState> => {
  const redis = await getRedis();
  const now = new Date().toISOString();
  const state: HeartbeatExecutionState = {
    version: 1,
    ...input,
    status: "reserved",
    mutationStarted: false,
    notificationDelivered: false,
    createdAt: now,
    updatedAt: now,
  };
  const created = await redis.set(
    executionKey(input.executionId),
    JSON.stringify(state),
    "EX",
    EXECUTION_TTL_SECONDS,
    "NX",
  );
  if (created === "OK") return state;

  const existing = await getHeartbeatExecution(input.executionId);
  if (existing && sameIdentity(existing, input)) return existing;
  throw new Error("Heartbeat execution reservation conflict");
};

export const verifyHeartbeatExecutionReservation = async ({
  executionId,
  agentId,
  claimedAt,
}: {
  executionId: string;
  agentId: string;
  claimedAt: string;
}): Promise<HeartbeatExecutionState | null> => {
  const state = await getHeartbeatExecution(executionId);
  if (
    !state ||
    state.agentId !== agentId ||
    state.claimedAt !== claimedAt ||
    state.status !== "reserved"
  ) {
    return null;
  }
  return state;
};

export const startHeartbeatExecution = async (
  identity: ExecutionIdentity,
): Promise<HeartbeatExecutionState> => {
  const stored = await getStoredExecution(identity.executionId);
  if (!stored || !sameIdentity(stored.state, identity)) {
    throw new Error("Heartbeat execution identity mismatch");
  }
  if (stored.state.status !== "reserved") {
    throw new Error(`Heartbeat execution is ${stored.state.status}`);
  }
  const next: HeartbeatExecutionState = {
    ...stored.state,
    status: "running",
    updatedAt: new Date().toISOString(),
  };
  if (!(await compareAndSet(identity.executionId, stored.raw, next))) {
    throw new Error("Heartbeat execution was already started");
  }
  return next;
};

const updateExecution = async (
  executionId: string,
  update: (state: HeartbeatExecutionState) => HeartbeatExecutionState | null,
): Promise<HeartbeatExecutionState | null> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await getStoredExecution(executionId);
    if (!stored) return null;
    const next = update(stored.state);
    if (!next) return stored.state;
    if (await compareAndSet(executionId, stored.raw, next)) return next;
  }
  throw new Error("Heartbeat execution state changed concurrently");
};

export const markHeartbeatMutationStarted = async (
  executionId: string,
): Promise<void> => {
  await updateExecution(executionId, (state) => {
    if (state.status !== "running") {
      throw new Error(`Heartbeat execution is ${state.status}`);
    }
    if (state.mutationStarted) return null;
    return {
      ...state,
      mutationStarted: true,
      updatedAt: new Date().toISOString(),
    };
  });
};

export const completeHeartbeatExecution = async (
  executionId: string,
): Promise<void> => {
  await updateExecution(executionId, (state) => {
    if (state.status === "completed") return null;
    // The assistant ChatMessage is the authoritative completion record. A
    // process can persist it and die before updating Redis, so recovery may
    // legitimately promote failed/uncertain/reconciliation state to completed.
    return {
      ...state,
      status: "completed",
      updatedAt: new Date().toISOString(),
    };
  });
};

export const failHeartbeatExecution = async (
  executionId: string,
  failure: string,
): Promise<void> => {
  await updateExecution(executionId, (state) => {
    if (
      ["completed", "failed", "uncertain", "needs_reconciliation"].includes(
        state.status,
      )
    ) {
      return null;
    }
    return {
      ...state,
      status: "failed",
      failure: failure.slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
  });
};

export const markHeartbeatExecutionNeedsReconciliation = async (
  executionId: string,
  failure: string,
): Promise<void> => {
  await updateExecution(executionId, (state) => {
    if (state.status === "needs_reconciliation") return null;
    if (state.status === "reserved") {
      throw new Error("Reserved heartbeat execution is safe to retry");
    }
    return {
      ...state,
      status: "needs_reconciliation",
      failure: failure.slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
  });
};

export const markHeartbeatNotificationDelivered = async (
  executionId: string,
): Promise<void> => {
  await updateExecution(executionId, (state) => {
    if (state.notificationDelivered) return null;
    return {
      ...state,
      notificationDelivered: true,
      updatedAt: new Date().toISOString(),
    };
  });
};
