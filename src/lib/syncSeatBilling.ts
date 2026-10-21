import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { completePendingStripeCancellation } from "@/lib/pendingStripeSubscriptionCancellation";
import { stripe } from "@/lib/subscription";
import { isTeamComped } from "@/lib/teamComp";
import { resolveSeatQuantity } from "@/lib/resolveSeatQuantity";
import { isSubscriptionActive } from "@/lib/constants/constants";
import { reportError } from "@/lib/errors/reportError";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";

export type SeatBillingResult =
  "SEATED" | "RECONCILED" | "OK" | "SKIPPED" | "Error";

type SeatBillingTeam = {
  totalSeats: number;
  activeSubscriptionPlanId: string | null;
  activeSubscriptionPlanItemId: string | null;
  compedUntil: Date | null;
  subscriptionPlan: Array<{
    id: string;
    teamId: string;
    subscriptionId: string;
    subscriptionItemId: string;
    subscriptionStatus: string;
    priceId: string;
    subscriptionObject: Prisma.JsonValue | null;
  }>;
};

type SeatBillingSubscriptionItem = {
  id: string;
  quantity?: number | null;
  priceId?: string | null;
  subscriptionId?: string | null;
};

export type SeatBillingAdapter = {
  findTeam: (teamId: string) => Promise<SeatBillingTeam | null>;
  resolveQuantity: (teamId: string, totalSeats: number) => Promise<number>;
  retrieveSubscriptionItem: (
    itemId: string,
  ) => Promise<SeatBillingSubscriptionItem>;
  listSubscriptionItems?: (
    subscriptionId: string,
  ) => Promise<SeatBillingSubscriptionItem[]>;
  repairSubscriptionItemId?: (
    teamId: string,
    subscriptionId: string,
    expectedTeamItemId: string | null,
    expectedPlanItemId: string,
    currentItemId: string,
  ) => Promise<boolean>;
  repairPendingCancellation?: (
    plan: SeatBillingTeam["subscriptionPlan"][number],
    assertHeld: () => void,
  ) => Promise<boolean>;
  updateSubscriptionItem: (
    itemId: string,
    update: {
      quantity: number;
      proration_behavior: "none" | "always_invoice" | "create_prorations";
    },
    requestOptions?: { idempotencyKey: string; timeout: number },
  ) => Promise<unknown>;
  reportFailure: (error: Error, teamId: string) => Promise<unknown>;
};

export type SeatBillingSerializer = <T>(
  teamId: string,
  run: (assertHeld: () => void) => Promise<T>,
) => Promise<T>;

const STRIPE_UPDATE_TIMEOUT_MS = 15_000;

const productionAdapter: SeatBillingAdapter = {
  findTeam: (teamId) =>
    prisma.team.findUnique({
      where: { id: teamId },
      select: {
        totalSeats: true,
        activeSubscriptionPlanId: true,
        activeSubscriptionPlanItemId: true,
        compedUntil: true,
        subscriptionPlan: {
          select: {
            id: true,
            teamId: true,
            subscriptionId: true,
            subscriptionItemId: true,
            subscriptionStatus: true,
            priceId: true,
            subscriptionObject: true,
          },
        },
      },
    }),
  resolveQuantity: resolveSeatQuantity,
  retrieveSubscriptionItem: (itemId) =>
    stripe.subscriptionItems.retrieve(itemId).then((item) => ({
      id: item.id,
      quantity: item.quantity,
      priceId: item.price.id,
      subscriptionId: item.subscription,
    })),
  listSubscriptionItems: (subscriptionId) =>
    stripe.subscriptionItems
      .list({ subscription: subscriptionId, limit: 100 })
      .then((items) =>
        items.data.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          priceId: item.price.id,
          subscriptionId: item.subscription,
        })),
      ),
  repairSubscriptionItemId: async (
    teamId,
    subscriptionId,
    expectedTeamItemId,
    expectedPlanItemId,
    currentItemId,
  ) => {
    return prisma.$transaction(async (tx) => {
      const teamNeedsRepair = expectedTeamItemId !== currentItemId;
      const planNeedsRepair = expectedPlanItemId !== currentItemId;
      const team = teamNeedsRepair
        ? await tx.team.updateMany({
            where: {
              id: teamId,
              activeSubscriptionPlanId: subscriptionId,
              activeSubscriptionPlanItemId: expectedTeamItemId,
            },
            data: { activeSubscriptionPlanItemId: currentItemId },
          })
        : { count: 1 };
      const plan = planNeedsRepair
        ? await tx.subscriptionPlan.updateMany({
            where: {
              teamId,
              subscriptionId,
              subscriptionItemId: expectedPlanItemId,
            },
            data: { subscriptionItemId: currentItemId },
          })
        : { count: 1 };
      if (team.count !== 1 || plan.count !== 1) {
        throw new Error("Seat billing pointers changed during repair");
      }
      return true;
    });
  },
  repairPendingCancellation: (plan, assertHeld) =>
    completePendingStripeCancellation(plan, assertHeld),
  updateSubscriptionItem: (itemId, update, requestOptions) =>
    stripe.subscriptionItems.update(itemId, update, requestOptions),
  reportFailure: (error, teamId) =>
    reportError({
      message: `Seat billing failed for team ${teamId}: ${error.message}`,
      stack: error.stack,
      source: "handled",
      extra: { teamId },
    }),
};

function isMissingSubscriptionItem(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    param?: unknown;
    rawType?: unknown;
    type?: unknown;
  };
  const codeAllows =
    candidate.code === "resource_missing" ||
    (candidate.code === undefined &&
      (candidate.rawType === "invalid_request_error" ||
        candidate.type === "invalid_request_error"));
  return (
    codeAllows &&
    (candidate.param === undefined || candidate.param === "id") &&
    typeof candidate.message === "string" &&
    /^(?:Invalid subscription_item id:|No such subscription(?:_| )item:)/.test(
      candidate.message,
    )
  );
}

function isStripeResourceMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}

class OrphanedSubscriptionItemError extends Error {
  constructor(itemId: string, subscriptionId: string) {
    super(
      `Subscription item ${itemId} is missing from Stripe and subscription ${subscriptionId} has no replacement for the active price`,
    );
    this.name = "OrphanedSubscriptionItemError";
  }
}

async function retrieveCurrentSubscriptionItem(
  teamId: string,
  team: SeatBillingTeam,
  activePlan: SeatBillingTeam["subscriptionPlan"][number] | undefined,
  itemId: string,
  adapter: SeatBillingAdapter,
  assertHeld: () => void,
): Promise<SeatBillingSubscriptionItem> {
  const subscriptionId = activePlan?.subscriptionId;
  if (!subscriptionId) {
    throw new Error("Seat billing has no authoritative active subscription");
  }

  let retrievalError: unknown = new Error(
    "Stored subscription item pointers disagree",
  );
  if (team.activeSubscriptionPlanItemId === activePlan.subscriptionItemId) {
    try {
      const item = await adapter.retrieveSubscriptionItem(itemId);
      const belongsToActivePlan =
        (item.subscriptionId === undefined ||
          item.subscriptionId === subscriptionId) &&
        (item.priceId === undefined || item.priceId === activePlan.priceId);
      if (belongsToActivePlan) {
        return item;
      }
      retrievalError = new Error(
        "Stored subscription item does not belong to the active plan",
      );
    } catch (error) {
      if (!isMissingSubscriptionItem(error)) throw error;
      retrievalError = error;
    }
  }

  if (!adapter.listSubscriptionItems || !adapter.repairSubscriptionItemId) {
    throw retrievalError;
  }
  let items: SeatBillingSubscriptionItem[];
  try {
    items = await adapter.listSubscriptionItems(subscriptionId);
  } catch (error) {
    if (!isStripeResourceMissing(error)) throw error;
    throw new OrphanedSubscriptionItemError(itemId, subscriptionId);
  }
  const priceMatches = items.filter(
    (item) =>
      item.priceId === activePlan.priceId &&
      (item.subscriptionId === undefined ||
        item.subscriptionId === subscriptionId),
  );
  const currentItem = priceMatches.length === 1 ? priceMatches[0] : undefined;
  if (!currentItem) {
    if (items.length === 0 && isMissingSubscriptionItem(retrievalError)) {
      throw new OrphanedSubscriptionItemError(itemId, subscriptionId);
    }
    throw retrievalError;
  }

  assertHeld();
  const repaired = await adapter.repairSubscriptionItemId(
    teamId,
    subscriptionId,
    team.activeSubscriptionPlanItemId,
    activePlan.subscriptionItemId,
    currentItem.id,
  );
  if (!repaired) throw retrievalError;
  assertHeld();
  return currentItem;
}

async function syncSeatBilling(
  teamId: string | undefined | null,
  adapter: SeatBillingAdapter,
  exact: boolean,
  assertHeld: () => void = () => {},
): Promise<SeatBillingResult> {
  if (!teamId) return "SKIPPED";
  try {
    const team = await adapter.findTeam(teamId);
    if (!team) return "SKIPPED";

    if (adapter.repairPendingCancellation) {
      for (const plan of team.subscriptionPlan) {
        assertHeld();
        await adapter.repairPendingCancellation(plan, assertHeld);
      }
    }

    if (isTeamComped(team)) return "SKIPPED";

    if (!team.activeSubscriptionPlanId) return "SKIPPED";
    const activePlan = team.subscriptionPlan.find(
      (plan) =>
        plan.subscriptionId === team.activeSubscriptionPlanId &&
        isSubscriptionActive(plan.subscriptionStatus),
    );
    if (!activePlan) return "SKIPPED";
    const itemId = activePlan.subscriptionItemId;
    if (!itemId) return "SKIPPED";

    const desiredQuantity = await adapter.resolveQuantity(
      teamId,
      team.totalSeats,
    );

    const item = await retrieveCurrentSubscriptionItem(
      teamId,
      team,
      activePlan,
      itemId,
      adapter,
      assertHeld,
    );
    const currentItemId = item.id;
    const currentQuantity = item.quantity ?? 0;
    if (
      desiredQuantity === currentQuantity ||
      (!exact && desiredQuantity < currentQuantity)
    ) {
      return "OK";
    }

    const isTrialing = activePlan?.subscriptionStatus === "trialing";

    assertHeld();
    await adapter.updateSubscriptionItem(
      currentItemId,
      {
        quantity: desiredQuantity,
        proration_behavior: isTrialing
          ? "none"
          : desiredQuantity > currentQuantity
            ? "always_invoice"
            : "create_prorations",
      },
      {
        idempotencyKey: `seat-billing-${randomUUID()}`,
        timeout: STRIPE_UPDATE_TIMEOUT_MS,
      },
    );
    assertHeld();
    return exact ? "RECONCILED" : "SEATED";
  } catch (error) {
    if (error instanceof OrphanedSubscriptionItemError) {
      console.warn("[seat-billing] orphaned subscription, skipping", {
        teamId,
        reason: error.message,
      });
      return "SKIPPED";
    }
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    await adapter.reportFailure(normalized, teamId).catch(() => {});
    return "Error";
  }
}

export async function syncSeatBillingOnJoin(
  teamId: string | undefined | null,
  adapter: SeatBillingAdapter = productionAdapter,
  serialize: SeatBillingSerializer = withTeamSeatBillingLock,
): Promise<SeatBillingResult> {
  if (!teamId) return "SKIPPED";
  try {
    return await serialize(teamId, (assertHeld) =>
      syncSeatBilling(teamId, adapter, false, assertHeld),
    );
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    await adapter.reportFailure(normalized, teamId).catch(() => {});
    return "Error";
  }
}

export const syncSeatBillingOnJoinSerialized = syncSeatBillingOnJoin;

export async function reconcileSeatBillingForTeam(
  teamId: string,
  adapter: SeatBillingAdapter = productionAdapter,
  serialize: SeatBillingSerializer = withTeamSeatBillingLock,
): Promise<SeatBillingResult> {
  try {
    return await serialize(teamId, (assertHeld) =>
      syncSeatBilling(teamId, adapter, true, assertHeld),
    );
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    await adapter.reportFailure(normalized, teamId).catch(() => {});
    return "Error";
  }
}

export type SeatBillingMutation<T> = {
  value: T;
  sync: boolean;
};

export async function mutateAndSyncSeatBilling<T>(
  teamId: string,
  mutate: (assertHeld: () => void) => Promise<SeatBillingMutation<T>>,
  options: {
    exact?: boolean;
    adapter?: SeatBillingAdapter;
    serialize?: SeatBillingSerializer;
  } = {},
): Promise<{ value: T; billing: SeatBillingResult }> {
  const adapter = options.adapter ?? productionAdapter;
  const serialize = options.serialize ?? withTeamSeatBillingLock;

  return serialize(teamId, async (assertHeld) => {
    assertHeld();
    const mutation = await mutate(assertHeld);
    assertHeld();
    if (!mutation.sync) return { value: mutation.value, billing: "OK" };
    const billing = await syncSeatBilling(
      teamId,
      adapter,
      options.exact ?? false,
      assertHeld,
    );
    return { value: mutation.value, billing };
  });
}
