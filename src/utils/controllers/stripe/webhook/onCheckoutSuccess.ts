import type { SubscriptionPlanStatus } from "@prisma/client";

import {
  completePendingStripeCancellation,
  subscriptionObjectWithPendingCancellation,
} from "@/lib/pendingStripeSubscriptionCancellation";
import prisma from "@/lib/prisma";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import type { PinnedApiVersionSubscription } from "@/lib/subscription";
import type { ISubscriptionPlan } from "@/models/model";
import generateSummaryAfterUpsertionReminder from "@/pages/api/queues/AiSummary/generateSummaryAfterUpsertionReminder";
import { convertTimestampToDate } from "@/utils/helperFunctions/helperFunctions";

import { applySubscriptionUpdatedWithTeamLockHeld } from "./onSubscriptionUpdated";

const persistedStripeSubscriptionStatuses = [
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
] as const satisfies readonly SubscriptionPlanStatus[];

const persistedSubscriptionStatus = (
  status: string,
): SubscriptionPlanStatus => {
  const persisted = persistedStripeSubscriptionStatuses.find(
    (candidate) => candidate === status,
  );
  if (!persisted) {
    throw new Error(`Unsupported Stripe subscription status: ${status}`);
  }
  return persisted;
};

const teamForCustomer = (customerId: string, teamId?: string) =>
  prisma.team.findFirst({
    where: {
      stripe_customer_id: customerId,
      ...(teamId ? { id: teamId } : {}),
    },
    include: {
      projects: { select: { id: true } },
      subscriptionPlan: true,
      members: true,
      googleAccount: true,
    },
  });

/**
 * Store a newly created Stripe subscription exactly once.
 *
 * Stripe can deliver both `customer.subscription.created` and
 * `checkout.session.completed` for the same subscription, then replay either
 * delivery. The team billing lease serializes those deliveries. The database
 * transaction prevents a failed first attempt from leaving a plan without its
 * matching active-team pointer.
 */
const sessionOnSuccess = async (
  subscription: PinnedApiVersionSubscription,
  plan: ISubscriptionPlan,
) => {
  const customerId = subscription.customer as string;
  const discoveredTeam = await teamForCustomer(customerId);
  if (!discoveredTeam) return;

  await withTeamSeatBillingLock(discoveredTeam.id, async (assertHeld) => {
    assertHeld();
    const team = await teamForCustomer(customerId, discoveredTeam.id);
    if (!team) return;

    for (const storedPlan of team.subscriptionPlan) {
      await completePendingStripeCancellation(storedPlan, assertHeld);
    }

    const existingPlan = team.subscriptionPlan.find(
      (candidate) => candidate.subscriptionId === subscription.id,
    );
    if (existingPlan) {
      await applySubscriptionUpdatedWithTeamLockHeld(
        subscription,
        plan,
        team.id,
        assertHeld,
      );
      return;
    }

    const subscriptionItem = subscription.items.data[0];
    if (!subscriptionItem) {
      throw new Error("Stripe subscription has no subscription item");
    }
    const subscriptionStatus = persistedSubscriptionStatus(subscription.status);
    const previousSubscriptionId = team.activeSubscriptionPlanId;
    const pendingPreviousSubscriptionId =
      previousSubscriptionId && previousSubscriptionId !== subscription.id
        ? previousSubscriptionId
        : null;

    const userIds = Array.from(
      new Set([
        team.googleAccount.userId,
        ...team.members.map((member) => member.userId),
      ]),
    );

    assertHeld();
    const storedPlan = await prisma.$transaction(async (tx) => {
      if (previousSubscriptionId) {
        await tx.subscriptionPlan.updateMany({
          where: {
            teamId: team.id,
            subscriptionId: { not: subscription.id },
            subscriptionStatus: { not: "Expired" },
          },
          data: { subscriptionStatus: "Expired" },
        });
      }

      const createdPlan = await tx.subscriptionPlan.create({
        data: {
          subscriptionStatus,
          ownerId: team.googleAccountId,
          projectIds: team.projects.map((project) => project.id),
          teamId: team.id,
          productId: plan.product,
          priceId: plan.id,
          subscriptionId: subscription.id,
          subscriptionItemId: subscriptionItem.id,
          totalSeats: team.totalSeats,
          interval: plan.interval,
          subscriptionStaretdAt: convertTimestampToDate(
            subscription.current_period_start,
          ),
          subscriptionEndsAt: convertTimestampToDate(
            subscription.current_period_end,
          ),
          nextIntervalAt: convertTimestampToDate(
            subscription.current_period_end,
          ),
          subscriptionObject: subscriptionObjectWithPendingCancellation(
            subscription,
            pendingPreviousSubscriptionId,
          ),
        },
      });

      await tx.team.update({
        where: { id: team.id },
        data: {
          activeSubscriptionPlanId: createdPlan.subscriptionId,
          activeSubscriptionPlanItemId: subscriptionItem.id,
          ...(subscription.status === "trialing"
            ? {
                team_activity: {
                  update: { data: { hasCompletedTrial: true } },
                },
              }
            : {}),
        },
      });
      await tx.userSetting.updateMany({
        where: { userId: { in: userIds } },
        data: { trialStatus: true },
      });
      return createdPlan;
    });

    generateSummaryAfterUpsertionReminder(team.id);
    assertHeld();
    await completePendingStripeCancellation(storedPlan, assertHeld);
  });
};

export default sessionOnSuccess;
