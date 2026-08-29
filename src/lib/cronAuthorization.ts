export function hasValidCronAuthorization(
  authorizationHeader: string | null | undefined,
  cronSecret: string | undefined,
): boolean {
  return Boolean(
    cronSecret && authorizationHeader === `Bearer ${cronSecret}`,
  );
}
