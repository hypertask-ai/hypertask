import type { Prisma } from "@prisma/client";

export const teamBillingSnapshotSelect = {
  id: true,
  title: true,
  activeSubscriptionPlanId: true,
  compedUntil: true,
  compedPlan: true,
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
