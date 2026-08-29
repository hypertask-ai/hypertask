import type { Prisma } from "@prisma/client";

/** Public team fields needed to resolve AI model access after switching boards. */
export const teamBillingSnapshotSelect = {
  id: true,
  title: true,
  activeSubscriptionPlanId: true,
  compedUntil: true,
  subscriptionPlan: {
    select: {
      priceId: true,
      subscriptionId: true,
      subscriptionStatus: true,
    },
    orderBy: {
      subscriptionStaretdAt: "desc",
    },
  },
  byokApiKeys: {
    select: {
      provider: true,
      enabled: true,
    },
  },
} satisfies Prisma.TeamSelect;
