/**
 * One place that decides whether a stored subscription row still buys premium.
 *
 * HTPR-4863: `unpaid` is Stripe's own "collection failed, I have stopped
 * retrying" signal, so it drops the team to Free. `past_due` deliberately still
 * entitles: Stripe is mid-retry and the customer may not even know yet.
 *
 * This is an allowlist so an unrecognised or future status fails closed instead
 * of silently handing out premium. Matching is case-insensitive because rows
 * carry both Stripe's lowercase statuses and legacy `Paid`/`Active` values.
 */
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

/**
 * Picks the row a team's plan should be read from. An entitling row always wins,
 * including over the team's `activeSubscriptionPlanId` pointer, so a stale
 * pointer at a dead subscription cannot hide a live one. When nothing entitles
 * we still return a row (for its priceId), and callers must treat it as Free.
 */
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
