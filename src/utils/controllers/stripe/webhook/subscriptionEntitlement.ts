import type Stripe from "stripe";

export const ACCESS_REVOKING_SUBSCRIPTION_STATUSES = [
  "canceled",
  "incomplete_expired",
] as const satisfies readonly Stripe.Subscription.Status[];

const ACCESS_REVOKING_STATUSES = new Set<Stripe.Subscription.Status>(
  ACCESS_REVOKING_SUBSCRIPTION_STATUSES,
);

export function shouldClearTeamSubscriptionEntitlement(
  status: Stripe.Subscription.Status,
): boolean {
  return ACCESS_REVOKING_STATUSES.has(status);
}
