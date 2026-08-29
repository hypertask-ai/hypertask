import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { stripe } from "@/lib/subscription";

export const PENDING_STRIPE_CANCELLATION_KEY =
  "hypertaskPendingPreviousSubscriptionCancellationId";

export type PendingStripeCancellationPlan = {
  id: string;
  teamId: string;
  subscriptionId: string;
  subscriptionObject: Prisma.JsonValue | null;
};

export type PendingStripeCancellationAdapter = {
  retrieveSubscription: (
    subscriptionId: string,
  ) => Promise<{ cancel_at_period_end: boolean; status?: string } | null>;
  scheduleCancellation: (subscriptionId: string) => Promise<unknown>;
  clearPendingCancellation: (
    plan: PendingStripeCancellationPlan,
    subscriptionObject: Prisma.InputJsonValue,
  ) => Promise<boolean>;
};

const productionAdapter: PendingStripeCancellationAdapter = {
  retrieveSubscription: async (subscriptionId) => {
    try {
      return await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        (error as { code?: unknown }).code === "resource_missing"
      ) {
        return null;
      }
      throw error;
    }
  },
  scheduleCancellation: (subscriptionId) =>
    stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    }),
  clearPendingCancellation: async (plan, subscriptionObject) => {
    const cleared = await prisma.subscriptionPlan.updateMany({
      where: {
        id: plan.id,
        teamId: plan.teamId,
        subscriptionId: plan.subscriptionId,
        subscriptionObject: {
          equals: plan.subscriptionObject as Prisma.InputJsonValue,
        },
      },
      data: { subscriptionObject },
    });
    return cleared.count === 1;
  },
};

export function subscriptionObjectWithPendingCancellation(
  subscription: unknown,
  previousSubscriptionId: string | null,
): Prisma.InputJsonValue {
  const subscriptionObject = subscription as unknown as Prisma.InputJsonObject;
  if (!previousSubscriptionId) return subscriptionObject;
  return {
    ...subscriptionObject,
    [PENDING_STRIPE_CANCELLATION_KEY]: previousSubscriptionId,
  };
}

export function pendingStripeCancellationId(
  subscriptionObject: Prisma.JsonValue | null | undefined,
): string | null {
  if (
    !subscriptionObject ||
    typeof subscriptionObject !== "object" ||
    Array.isArray(subscriptionObject)
  ) {
    return null;
  }
  const pending = (subscriptionObject as Prisma.JsonObject)[
    PENDING_STRIPE_CANCELLATION_KEY
  ];
  return typeof pending === "string" && pending.length > 0 ? pending : null;
}

function withoutPendingCancellation(
  subscriptionObject: Prisma.JsonValue,
): Prisma.InputJsonValue {
  const cleaned = { ...(subscriptionObject as Prisma.JsonObject) };
  delete cleaned[PENDING_STRIPE_CANCELLATION_KEY];
  return cleaned as Prisma.InputJsonObject;
}

/**
 * Finish the external half of a committed subscription replacement.
 *
 * The pending subscription id lives on the new plan before the database
 * transaction commits. A failed Stripe call or process exit leaves that marker
 * for the webhook replay and nightly seat reconciliation to retry.
 */
export async function completePendingStripeCancellation(
  plan: PendingStripeCancellationPlan,
  assertHeld: () => void,
  adapter: PendingStripeCancellationAdapter = productionAdapter,
): Promise<boolean> {
  const previousSubscriptionId = pendingStripeCancellationId(
    plan.subscriptionObject,
  );
  if (!previousSubscriptionId) return false;
  if (previousSubscriptionId === plan.subscriptionId) {
    throw new Error(
      "Pending Stripe cancellation targets the active subscription",
    );
  }

  assertHeld();
  const previousSubscription = await adapter.retrieveSubscription(
    previousSubscriptionId,
  );
  assertHeld();
  if (
    previousSubscription &&
    previousSubscription.status !== "canceled" &&
    !previousSubscription.cancel_at_period_end
  ) {
    await adapter.scheduleCancellation(previousSubscriptionId);
    assertHeld();
  }

  const cleared = await adapter.clearPendingCancellation(
    plan,
    withoutPendingCancellation(plan.subscriptionObject as Prisma.JsonValue),
  );
  if (!cleared) {
    throw new Error("Pending Stripe cancellation changed during repair");
  }
  assertHeld();
  return true;
}
