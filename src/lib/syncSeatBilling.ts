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

/**
 * Stripe is inconsistent about how it says "that subscription item is gone".
 * Retrieving a well-formed-but-unknown id answers `No such subscription_item:`
 * with `code: "resource_missing"`, while a malformed id answers
 * `Invalid subscription_item id:` with a bare `invalid_request_error` and no
 * `code` and no `param` at all. Stripe Node keeps that API value in `rawType`
 * and exposes `StripeInvalidRequestError` as `type`. Requiring
 * `resource_missing` therefore missed
 * the second shape entirely, so HTPR-5571's orphan skip never ran and the
 * nightly reconcile cron kept refiling the same ticket (HTPR-5620/HTPR-5621).
 *
 * The message regex is load-bearing: it, not the code, is what proves this is a
 * missing item rather than some other invalid request. If Stripe ever rewords
 * either sentence this predicate silently stops matching.
 */
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

/**
 * The stored Stripe item is gone AND Stripe holds no replacement for the active
 * price, so there is no quantity anywhere left to correct. Unbillable and
 * unrepairable is a team to skip, not a failure to report: the nightly reconcile
 * cron would otherwise refile an identical ticket every night forever, which is
 * exactly what two abandoned 2023 test teams did to the bug board (HTPR-5571).
 */
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
    // The subscription itself is gone, so it cannot hold a replacement item.
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
    // Orphaned only when the stored item is absent AND the subscription carries no
    // items at all. A subscription holding items at other prices is a genuine
    // mismatch: real money on the wrong price, and it stays loud.
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

/**
 * Bring a team's Stripe seat quantity in line with reality after someone joins.
 *
 * Replaces the old two-step "pay a one-off invoice, then also bump the quantity",
 * which billed the same seat twice and used hard-coded amounts that mischarged
 * custom-priced plans (HTPR-4216). One quantity change, prorated at the
 * subscription's real price, is the whole charge.
 *
 * Returns SEATED when Stripe was charged, OK when the seat was already paid for,
 * SKIPPED for comped or unsubscribed teams, and Error when Stripe rejected the change.
 */
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

    // Comped teams are flat-fee with unlimited members; member churn must never
    // rewrite their Stripe quantity (HTPR-4831).
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

    // Counts accepted members AND people invited but not yet accepted, whose seats
    // are already reserved. Comparing against bare totalSeats let a new joiner
    // silently consume a reserved seat and leave Stripe under-billed by one.
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

    // A trial has nothing to invoice yet; Stripe bills the new quantity when it converts.
    const isTrialing = activePlan?.subscriptionStatus === "trialing";

    // The lease retains at least 30 seconds here, while Stripe is bounded to 15.
    // That prevents another writer acquiring the team lock while this request can
    // still complete. An operation key also makes Stripe retries idempotent.
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
    // Nothing to bill and nothing to fix: skip instead of refiling the same
    // ticket on every nightly reconcile. Quiet on the board, not invisible: if a
    // paying team's subscription is ever deleted by hand this is the only trace,
    // so it stays in the logs.
    if (error instanceof OrphanedSubscriptionItemError) {
      console.warn("[seat-billing] orphaned subscription, skipping", {
        teamId,
        reason: error.message,
      });
      return "SKIPPED";
    }
    // Callers deliberately don't block the join on this, so a failure here is
    // silent revenue loss unless it raises a ticket. Report it rather than
    // leaving it in the logs for nobody to read.
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

// Compatibility name for callers migrated while the serialized API was introduced.
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

/** Hold the team lease across the membership mutation and the Stripe write. */
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
