import { z } from "zod";
import { deriveTeamBilling } from "@/lib/deriveCurrentBoardBilling";
import { pickEntitlingSubscriptionRow } from "@/lib/subscriptionAccess";
import { storeSubscriptionPlans } from "@/lib/subscriptionPlans";
import { isTeamComped } from "@/lib/teamComp";
import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import type { ITeam } from "@/models/model";

const subscriptionSnapshot = z.object({
  cancel_at_period_end: z.boolean().optional(),
  items: z.object({
    data: z.array(z.object({
      price: z.object({
        id: z.string(),
        currency: z.string().regex(/^[a-zA-Z]{3}$/),
        unit_amount: z.number().nullable(),
        recurring: z.object({ interval: z.enum(["day", "week", "month", "year"]), interval_count: z.number().int().positive() }).nullable(),
      }),
    })),
  }).optional(),
});

export function settingsBillingSummary(team: ITeam) {
  const row = pickEntitlingSubscriptionRow(team.subscriptionPlan, team.activeSubscriptionPlanId);
  const terminal = row && ["Free", "canceled", "incomplete_expired"].includes(row.subscriptionStatus);
  const hasSubscription = Boolean(
    (team.activeSubscriptionPlanId && (row?.subscriptionId !== team.activeSubscriptionPlanId || !terminal)) ||
    (row?.subscriptionId && !terminal),
  );
  const billing = deriveTeamBilling(team);
  const comped = isTeamComped(team);
  const snapshot = subscriptionSnapshot.safeParse(row?.subscriptionObject);
  const price = snapshot.success
    ? snapshot.data.items?.data.find((item) => item.price.id === row?.priceId)?.price
    : undefined;
  const catalogPrice = storeSubscriptionPlans.flatMap((plan) => plan.types)
    .find((type) => type.stripePriceId === row?.priceId);
  let priceLabel = hasSubscription ? "See Stripe for pricing" : comped ? "Complimentary" : "$0";
  if (hasSubscription && price?.unit_amount != null && price.recurring) {
    const amount = new Intl.NumberFormat("en", { style: "currency", currency: price.currency }).format(price.unit_amount / 100);
    const interval = price.recurring.interval_count === 1 ? price.recurring.interval
      : `${price.recurring.interval_count} ${price.recurring.interval}s`;
    priceLabel = `${amount} per user / ${interval}`;
  } else if (hasSubscription && catalogPrice) {
    priceLabel = `${catalogPrice.price} ${catalogPrice.description}`;
  }
  let status = comped ? "Complimentary" : "Free";
  if (hasSubscription) {
    switch (row?.subscriptionStatus) {
      case "trialing": status = "Trial"; break;
      case "past_due": status = "Payment overdue"; break;
      case "unpaid": status = "Unpaid"; break;
      case "incomplete": status = "Payment incomplete"; break;
      default: status = "Active";
    }
    if (snapshot.success && snapshot.data.cancel_at_period_end) status = "Cancels at period end";
  }
  const subscriptionPlan = planKindFromStripePriceId(row?.priceId).storePlanId;
  let plan: string = billing?.storePlanId ?? "Free";
  if (hasSubscription) plan = subscriptionPlan === "Free" ? "Custom plan" : subscriptionPlan;
  return {
    plan,
    price: priceLabel,
    status,
    hasSubscription,
    canUpgrade: !hasSubscription && !comped,
  };
}
