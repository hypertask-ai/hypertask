export const DEFAULT_LEASE_TTL_SECONDS = 300;
export const MIN_LEASE_TTL_SECONDS = 60;
export const MAX_LEASE_TTL_SECONDS = 1800;

export function clampLeaseTtlSeconds(ttlSeconds?: number): number {
  if (ttlSeconds === undefined || !Number.isFinite(ttlSeconds)) {
    return DEFAULT_LEASE_TTL_SECONDS;
  }

  return Math.min(
    MAX_LEASE_TTL_SECONDS,
    Math.max(MIN_LEASE_TTL_SECONDS, ttlSeconds)
  );
}

export function isLeaseLive(
  expiresAt: Date | string | number,
  now: Date | string | number = new Date()
): boolean {
  return new Date(expiresAt).getTime() > new Date(now).getTime();
}

export function canManageLease(
  holder: number,
  leaseAgentId: string | null,
  callerId: number,
  callerAgentId: string | null
): boolean {
  return (
    holder === callerId &&
    (callerAgentId === null || leaseAgentId === callerAgentId)
  );
}

export function isValidTaskId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
