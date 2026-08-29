import type { Prisma, SubscriptionPlanStatus } from "@prisma/client";

import { completePendingStripeCancellation } from "@/lib/pendingStripeSubscriptionCancellation";
import prisma from "@/lib/prisma";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import type { PinnedApiVersionSubscription } from "@/lib/subscription";
import { ISubscriptionPlan } from "@/models/model";
import { convertTimestampToDate } from "@/utils/helperFunctions/helperFunctions";
import {
  ACCESS_REVOKING_SUBSCRIPTION_STATUSES,
  shouldClearTeamSubscriptionEntitlement,
} from "./subscriptionEntitlement";

const accessRevokingPlanStatuses = [
  ...ACCESS_REVOKING_SUBSCRIPTION_STATUSES,
] as SubscriptionPlanStatus[];

const teamForCustomer = (customerId: string, teamId: string) =>
  prisma.team.findFirst({
    where: {
      id: teamId,
      stripe_customer_id: customerId,
    },
    include: {
      projects: {
        select: { id: true },
      },
      subscriptionPlan: true,
      members: true,
      googleAccount: true,
    },
  });

export const applySubscriptionUpdatedWithTeamLockHeld = async (
  subscription: PinnedApiVersionSubscription,
  plan: ISubscriptionPlan | undefined,
  teamId: string,
  assertHeld: () => void,
) => {
  assertHeld();
  const teamToPayFor = await teamForCustomer(
    subscription.customer as string,
    teamId,
  );

  if (!teamToPayFor) return;

  for (const candidate of teamToPayFor.subscriptionPlan) {
    await completePendingStripeCancellation(candidate, assertHeld);
  }

  const storedPlan = teamToPayFor.subscriptionPlan.find(
    (candidate) => candidate.subscriptionId === subscription.id,
  );
  if (!storedPlan) {
    // `customer.subscription.created` owns creation. Requiring its stored
    // Hypertask plan also prevents unrelated subscriptions on the customer
    // from consuming trial eligibility or recreating access.
    console.warn(
      `Ignoring update for unknown Stripe subscription ${subscription.id}`,
    );
    return;
  }

  const recordsTrialHistory =
    subscription.status === "trialing" ||
    typeof subscription.trial_start === "number" ||
    typeof subscription.trial_end === "number";

  // Trial eligibility is sticky history. Persist it before terminal handling so
  // reordered cancellation/conversion events cannot erase the only evidence
  // that this team already received a trial.
  if (recordsTrialHistory) {
    assertHeld();
    await prisma.team_Activity.updateMany({
      where: { teamId: teamToPayFor.id },
      data: { hasCompletedTrial: true },
    });
  }

  if (shouldClearTeamSubscriptionEntitlement(subscription.status)) {
    assertHeld();
    await prisma.$transaction(async (tx) => {
      // Lock the plan before the team. The non-terminal path uses the same lock
      // order, so a terminal transition always wins over an in-flight stale
      // update for this subscription.
      await tx.subscriptionPlan.updateMany({
        where: { subscriptionId: subscription.id },
        data: {
          subscriptionStatus: subscription.status as SubscriptionPlanStatus,
        },
      });
      await tx.team.updateMany({
        where: {
          id: teamToPayFor.id,
          activeSubscriptionPlanId: subscription.id,
        },
        data: {
          activeSubscriptionPlanId: null,
          activeSubscriptionPlanItemId: null,
        },
      });
    });
    return;
  }

  if (!plan) {
    throw new Error("Stripe subscription update is missing its plan");
  }

  const subscriptionItem = subscription.items.data[0];
  if (!subscriptionItem) {
    throw new Error("Stripe subscription update has no subscription item");
  }

  assertHeld();
  const activated = await prisma.$transaction(async (tx) => {
    const updatedPlan = await tx.subscriptionPlan.updateMany({
      where: {
        subscriptionId: subscription.id,
        subscriptionStatus: { notIn: accessRevokingPlanStatuses },
      },
      data: {
        // Stripe SDK 22 widened Status beyond the pinned Prisma enum. HTPR-4744
        // owns the complete mapping; these runtime values already match it.
        subscriptionStatus: subscription.status as SubscriptionPlanStatus,
        ownerId: teamToPayFor.googleAccountId,
        projectIds: teamToPayFor.projects.map((item) => item.id),
        teamId: teamToPayFor.id,
        productId: plan.product,
        priceId: plan.id,
        subscriptionId: subscription.id,
        subscriptionItemId: subscriptionItem.id,
        totalSeats: teamToPayFor.totalSeats,
        interval: plan.interval,
        subscriptionStaretdAt: convertTimestampToDate(
          subscription.current_period_start,
        ),
        subscriptionEndsAt: convertTimestampToDate(
          subscription.current_period_end,
        ),
        nextIntervalAt: convertTimestampToDate(subscription.current_period_end),
        subscriptionObject: subscription as unknown as Prisma.InputJsonValue,
      },
    });

    if (updatedPlan.count === 0) return false;

    const updatedTeam = await tx.team.updateMany({
      where: {
        id: teamToPayFor.id,
        OR: [
          { activeSubscriptionPlanId: null },
          { activeSubscriptionPlanId: subscription.id },
        ],
      },
      data: {
        activeSubscriptionPlanId: subscription.id,
        activeSubscriptionPlanItemId: subscriptionItem.id,
      },
    });

    if (updatedTeam.count === 0) return false;

    return true;
  });

  if (!activated) return;

  const userIds = Array.from(
    new Set([
      teamToPayFor.googleAccount.userId,
      ...teamToPayFor.members.map((member) => member.userId),
    ]),
  );
  assertHeld();
  await prisma.userSetting.updateMany({
    where: { userId: { in: userIds } },
    data: { trialStatus: true },
  });
};

const onSubscriptionUpdated = async (
  subscription: PinnedApiVersionSubscription,
  plan?: ISubscriptionPlan,
) => {
  const discoveredTeam = await prisma.team.findFirst({
    where: {
      stripe_customer_id: subscription.customer as string,
    },
    select: { id: true },
  });
  if (!discoveredTeam) return;

  await withTeamSeatBillingLock(discoveredTeam.id, (assertHeld) =>
    applySubscriptionUpdatedWithTeamLockHeld(
      subscription,
      plan,
      discoveredTeam.id,
      assertHeld,
    ),
  );
};

export default onSubscriptionUpdated;
