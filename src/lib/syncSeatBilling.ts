import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { clearStoredSubscriptionEntitlement } from "@/lib/clearStoredSubscriptionEntitlement";
import prisma from "@/lib/prisma";
import { completePendingStripeCancellation } from "@/lib/pendingStripeSubscriptionCancellation";
import { stripe } from "@/lib/subscription";
import { isTeamComped } from "@/lib/teamComp";
import { resolveSeatQuantity } from "@/lib/resolveSeatQuantity";
import { isSubscriptionActive } from "@/lib/constants/constants";
import { reportError } from "@/lib/errors/reportError";
import { refreshStripeSubscriptionSnapshotWithLockHeld } from "@/lib/stripeSubscriptionSnapshot";
import {
  createMemorySeatBillingWrites,
  SeatBillingWriteUnsettledError,
  seatBillingWrites,
  withTeamSeatBillingLock,
  type PendingSeatBillingWrite,
  type SeatBillingLedgerScope,
  type SeatBillingProration,
  type SeatBillingWriteLedger,
} from "@/lib/seatBillingLock";
import { shouldClearTeamSubscriptionEntitlement } from "@/utils/controllers/stripe/webhook/subscriptionEntitlement";

export type SeatBillingResult =
  "SEATED" | "RECONCILED" | "OK" | "SKIPPED" | "Error";

type SeatBillingTeam = {
  totalSeats: number;
  activeSubscriptionPlanId: string | null;
  activeSubscriptionPlanItemId: string | null;
  stripe_customer_id: string | null;
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
  retrieveSubscription?: (subscriptionId: string) => Promise<{
    status: Stripe.Subscription.Status;
    customer: string | { id: string };
  }>;
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
  refreshSubscriptionSnapshot?: (teamId: string, subscriptionId: string, assertHeld: () => void) => Promise<unknown>;
  updateSubscriptionItem: (
    itemId: string,
    update: {
      quantity: number;
      proration_behavior: SeatBillingProration;
    },
    requestOptions: { idempotencyKey: string; timeout: number },
  ) => Promise<unknown>;
  reportFailure: (error: Error, teamId: string) => Promise<unknown>;
  writes?: SeatBillingWriteLedger;
};

export type SeatBillingSerializer = <T>(
  teamId: string,
  run: (assertHeld: () => void, ledgerScope?: SeatBillingLedgerScope) => Promise<T>,
) => Promise<T>;

const STRIPE_UPDATE_TIMEOUT_MS = 15_000;

function terminalStatusSynced(value: unknown) {
  return !!value && typeof value === "object" &&
    typeof (value as { statusSynced?: unknown }).statusSynced === "string";
}

const productionAdapter: SeatBillingAdapter = {
  findTeam: (teamId) =>
    prisma.team.findUnique({
      where: { id: teamId },
      select: {
        totalSeats: true,
        activeSubscriptionPlanId: true,
        activeSubscriptionPlanItemId: true,
        stripe_customer_id: true,
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
  refreshSubscriptionSnapshot: refreshStripeSubscriptionSnapshotWithLockHeld,
  retrieveSubscription: (subscriptionId) =>
    stripe.subscriptions.retrieve(subscriptionId),
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

async function skipBecauseStripeRevokedAccess(
  teamId: string,
  team: SeatBillingTeam,
  subscriptionId: string,
  adapter: SeatBillingAdapter,
  assertHeld: () => void,
): Promise<boolean> {
  if (!adapter.retrieveSubscription) return false;
  let subscription: Awaited<
    ReturnType<NonNullable<SeatBillingAdapter["retrieveSubscription"]>>
  >;
  try {
    subscription = await adapter.retrieveSubscription(subscriptionId);
  } catch (error) {
    if (isStripeResourceMissing(error)) return false;
    throw error;
  }
  if (!shouldClearTeamSubscriptionEntitlement(subscription.status)) return false;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  if (!team.stripe_customer_id || customerId !== team.stripe_customer_id) {
    throw new Error(
      "Stripe subscription does not match the saved active seat item",
    );
  }
  assertHeld();
  await clearStoredSubscriptionEntitlement(
    teamId,
    subscriptionId,
    subscription.status,
  );
  return true;
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

function isDefinitiveStripeRejection(error: unknown): boolean {
  const { code, rawType, type, statusCode } = (error ?? {}) as Record<string, unknown>;
  if (code === "idempotency_key_in_use" || statusCode === 409 || statusCode === 429 || (typeof statusCode === "number" && statusCode >= 500)) return false;
  return code === "resource_missing" || rawType === "invalid_request_error" ||
    type === "invalid_request_error" || type === "StripeInvalidRequestError" ||
    (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500);
}

async function settleSeatBillingWrite(
  teamId: string,
  write: PendingSeatBillingWrite,
  subscriptionId: string,
  activeItemId: string,
  adapter: SeatBillingAdapter,
  ledger: SeatBillingWriteLedger,
): Promise<void> {
  if (write.subscriptionId === subscriptionId && write.itemId === activeItemId) {
    try {
      await adapter.updateSubscriptionItem(
        write.itemId,
        { quantity: write.quantity, proration_behavior: write.prorationBehavior },
        { idempotencyKey: write.idempotencyKey, timeout: STRIPE_UPDATE_TIMEOUT_MS },
      );
    } catch (error) {
      if (isDefinitiveStripeRejection(error)) {
        await ledger.clear(teamId, write);
      }
      throw error;
    }
  }
  await ledger.clear(teamId, write);
}

async function syncSeatBilling(
  teamId: string | undefined | null,
  adapter: SeatBillingAdapter,
  exact: boolean,
  assertHeld: () => void = () => {},
  ledgerScope: SeatBillingLedgerScope = "unlocked",
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

    if (
      await skipBecauseStripeRevokedAccess(
        teamId,
        team,
        activePlan.subscriptionId,
        adapter,
        assertHeld,
      )
    ) {
      return "SKIPPED";
    }

    const ledger = adapter.writes ??
      (ledgerScope === "locked" ? seatBillingWrites : createMemorySeatBillingWrites());
    const unsettled = await ledger.load(teamId);
    if (unsettled) {
      assertHeld();
      await settleSeatBillingWrite(teamId, unsettled, activePlan.subscriptionId, itemId, adapter, ledger).catch((error: unknown) => {
        if (!isDefinitiveStripeRejection(error)) throw error;
      });
      assertHeld();
    }

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
    const refreshed = await adapter.refreshSubscriptionSnapshot?.(
      teamId, activePlan.subscriptionId, assertHeld,
    );
    if (terminalStatusSynced(refreshed)) return "OK";
    if (
      desiredQuantity === currentQuantity ||
      (!exact && desiredQuantity < currentQuantity)
    ) {
      return "OK";
    }

    const write: PendingSeatBillingWrite = {
      idempotencyKey: `seat-billing-${teamId}-${randomUUID()}`,
      itemId: currentItemId,
      subscriptionId: activePlan.subscriptionId,
      quantity: desiredQuantity,
      prorationBehavior:
        activePlan?.subscriptionStatus === "trialing"
          ? "none"
          : desiredQuantity > currentQuantity
            ? "always_invoice"
            : "create_prorations",
    };
    if (!(await ledger.begin(teamId, write))) {
      throw new SeatBillingWriteUnsettledError();
    }
    assertHeld();
    await settleSeatBillingWrite(teamId, write, activePlan.subscriptionId, currentItemId, adapter, ledger);
    assertHeld();
    await adapter.refreshSubscriptionSnapshot?.(teamId, activePlan.subscriptionId, assertHeld);
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
    return await serialize(teamId, (assertHeld, ledgerScope) =>
      syncSeatBilling(teamId, adapter, false, assertHeld, ledgerScope),
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
    return await serialize(teamId, (assertHeld, ledgerScope) =>
      syncSeatBilling(teamId, adapter, true, assertHeld, ledgerScope),
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

  return serialize(teamId, async (assertHeld, ledgerScope) => {
    assertHeld();
    const mutation = await mutate(assertHeld);
    assertHeld();
    if (!mutation.sync) return { value: mutation.value, billing: "OK" };
    const billing = await syncSeatBilling(
      teamId,
      adapter,
      options.exact ?? false,
      assertHeld,
      ledgerScope,
    );
    return { value: mutation.value, billing };
  });
}
