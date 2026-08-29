export const USER_PROFILE_STALE_TIME_MS = 5 * 60 * 1000;

export const getUserProfileQueryOptions = (userId?: number | null) => ({
  queryKey: ["fetchUser", userId] as const,
  enabled: Number.isInteger(userId) && Number(userId) > 0,
  staleTime: USER_PROFILE_STALE_TIME_MS,
});
