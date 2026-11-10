const HOUR_MS = 60 * 60 * 1000;
export const WAITING_ON_OVERDUE_MS = 24 * HOUR_MS;

type WaitingAgent = {
  id: string;
  displayName: string | null;
  photoURL: string | null;
} | null;

type WaitingOnTask = {
  waitingOnAgentId?: string | null;
  waitingOnAgent?: WaitingAgent;
};

type WaitingOnWrite = {
  waitingOnUserId?: number | null;
  waitingOnSetById?: number | null;
  waitingOnSetAt?: string | null;
  waitingOnAgentId?: string | null;
  waitingOnAgent?: WaitingAgent;
};

export function applyWaitingOnWrite<T extends WaitingOnTask>(task: T, fields: WaitingOnWrite): T {
  const next = { ...task, ...fields };
  if (!Object.prototype.hasOwnProperty.call(fields, "waitingOnAgentId") || fields.waitingOnAgentId != null || fields.waitingOnAgent != null) {
    return next;
  }
  return { ...next, waitingOnAgentId: null, waitingOnAgent: null };
}

export const formatWaitingOnAge = (
  value: string | Date | null | undefined,
  now = Date.now()
) => {
  if (!value) return "";
  const elapsed = Math.max(0, now - new Date(value).getTime());
  if (elapsed < HOUR_MS) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  if (elapsed < WAITING_ON_OVERDUE_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  return `${Math.floor(elapsed / WAITING_ON_OVERDUE_MS)}d`;
};
