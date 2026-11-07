import type { Prisma, SubscriptionPlanStatus } from "@prisma/client";

import prisma from "@/lib/prisma";
import { stripe } from "@/lib/subscription";
import { subscriptionStatusGrantsAccess } from "@/lib/subscriptionAccess";
import {
  pendingStripeCancellationId,
  subscriptionObjectWithPendingCancellation,
} from "@/lib/pendingStripeSubscriptionCancellation";

const NON_ENTITLING_LOCAL_STATUS: Partial<Record<string, SubscriptionPlanStatus>> = {
  canceled: "canceled",
  unpaid: "unpaid",
  incomplete: "incomplete",
  incomplete_expired: "incomplete_expired",
  paused: "paused",
  ended: "ended",
};

export async function refreshStripeSubscriptionSnapshotWithLockHeld(
  teamId: string,
  subscriptionId: string,
  assertHeld: () => void,
  apply = true,
  preventSeatDecrease = false,
) {
  assertHeld();
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { teamId, subscriptionId },
    include: { team: { select: { stripe_customer_id: true, activeSubscriptionPlanId: true } } },
  });
  if (!plan || plan.team.activeSubscriptionPlanId !== subscriptionId ||
    !subscriptionStatusGrantsAccess(plan.subscriptionStatus)) {
    throw new Error("Snapshot refresh requires the team's active subscription");
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (subscription.id !== subscriptionId || customerId !== plan.team.stripe_customer_id) {
    throw new Error("Stripe subscription does not match the saved active seat item");
  }
  const localStatus = NON_ENTITLING_LOCAL_STATUS[subscription.status];
  if (!subscriptionStatusGrantsAccess(subscription.status)) {
    if (!localStatus) throw new Error("Stripe subscription does not match the saved active seat item");
    if (apply) {
      assertHeld();
      const saved = await prisma.subscriptionPlan.updateMany({
        where: {
          id: plan.id, teamId, subscriptionId,
          subscriptionStatus: plan.subscriptionStatus,
        },
        data: { subscriptionStatus: localStatus },
      });
      if (saved.count !== 1) throw new Error("Subscription snapshot changed during refresh");
    }
    return {
      subscriptionObject: plan.subscriptionObject,
      applied: apply,
      previousQuantity: null,
      quantity: null,
      statusSynced: localStatus,
    };
  }
  const item = subscription.items.data.find((candidate) => candidate.id === plan.subscriptionItemId);
  if (!item || item.price.id !== plan.priceId ||
    !Number.isSafeInteger(item.quantity) || item.quantity! < 1) {
    throw new Error("Stripe subscription does not match the saved active seat item");
  }
  const previous = plan.subscriptionObject as { items?: { data?: Array<{ id?: string; quantity?: number }> } } | null;
  const previousQuantity = previous?.items?.data?.find((candidate) => candidate.id === item.id)?.quantity ?? null;
  if (preventSeatDecrease && typeof previousQuantity === "number" && item.quantity! < previousQuantity) {
    throw new Error("Bulk snapshot refresh would lower a saved seat count; review this subscription separately");
  }
  const subscriptionObject = subscriptionObjectWithPendingCancellation(
    subscription, pendingStripeCancellationId(plan.subscriptionObject),
  );
  if (apply) {
    assertHeld();
    const saved = await prisma.subscriptionPlan.updateMany({
      where: {
        id: plan.id, teamId, subscriptionId,
        subscriptionItemId: plan.subscriptionItemId,
        subscriptionStatus: plan.subscriptionStatus,
        ...(plan.subscriptionObject == null ? {} : {
          subscriptionObject: { equals: plan.subscriptionObject as Prisma.InputJsonValue },
        }),
      },
      data: { subscriptionObject },
    });
    if (saved.count !== 1) throw new Error("Subscription snapshot changed during refresh");
  }
  return { subscriptionObject, applied: apply, previousQuantity, quantity: item.quantity! };
}
