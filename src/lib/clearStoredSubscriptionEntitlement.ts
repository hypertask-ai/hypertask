import type { SubscriptionPlanStatus } from "@prisma/client";

import prisma from "@/lib/prisma";
import { ACCESS_REVOKING_SUBSCRIPTION_STATUSES } from "@/utils/controllers/stripe/webhook/subscriptionEntitlement";

type RevokedSubscriptionStatus =
  (typeof ACCESS_REVOKING_SUBSCRIPTION_STATUSES)[number];

export async function clearStoredSubscriptionEntitlement(
  teamId: string,
  subscriptionId: string,
  status: RevokedSubscriptionStatus,
  db: typeof prisma = prisma,
) {
  await db.$transaction(async (tx) => {
    await tx.subscriptionPlan.updateMany({
      where: { subscriptionId },
      data: { subscriptionStatus: status as SubscriptionPlanStatus },
    });
    await tx.team.updateMany({
      where: {
        id: teamId,
        activeSubscriptionPlanId: subscriptionId,
      },
      data: {
        activeSubscriptionPlanId: null,
        activeSubscriptionPlanItemId: null,
      },
    });
  });
}
