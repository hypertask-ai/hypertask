const ENTITLING_SUBSCRIPTION_STATUSES = new Set<string>([
  "paid",
  "active",
  "trialing",
  "past_due",
]);

export function subscriptionStatusGrantsAccess(
  status: string | null | undefined,
): boolean {
  return (
    !!status && ENTITLING_SUBSCRIPTION_STATUSES.has(status.toLowerCase())
  );
}

type SubscriptionRowLike = {
  subscriptionId?: string | null;
  subscriptionStatus: string;
};

export function pickEntitlingSubscriptionRow<T extends SubscriptionRowLike>(
  rows: readonly T[] | null | undefined,
  activeSubscriptionPlanId?: string | null,
): T | null {
  if (!rows?.length) return null;
  const entitles = (row: T) =>
    subscriptionStatusGrantsAccess(row.subscriptionStatus);
  return (
    (activeSubscriptionPlanId &&
      rows.find(
        (row) => row.subscriptionId === activeSubscriptionPlanId && entitles(row),
      )) ||
    rows.find(entitles) ||
    (activeSubscriptionPlanId &&
      rows.find((row) => row.subscriptionId === activeSubscriptionPlanId)) ||
    rows[0] ||
    null
  );
}
