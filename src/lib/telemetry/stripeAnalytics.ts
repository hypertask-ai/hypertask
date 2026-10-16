import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import { isInviteSeatAnalyticsEnabled } from "./inviteAnalytics";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { scheduleAnalytics } from "./signupAnalytics";

type Coupon = {
  percent_off: number | null;
  amount_off: number | null;
  currency?: string | null;
  applies_to?: { products: string[] };
};
type Discount = { coupon?: Coupon; source?: { coupon?: string | Coupon | null } };
type Item = {
  id: string;
  quantity?: number;
  price: {
    id: string;
    product: string | { id: string };
    unit_amount: number | null;
    unit_amount_decimal?: string | Stripe.Decimal | null;
    currency: string;
    recurring: { interval: string } | null;
  };
  discounts?: (string | Discount)[];
};
export type AnalyticsSubscription = {
  id: string;
  customer: string | { id: string };
  status: string;
  items: { data: Item[] };
  discount?: Discount | null;
  discounts?: (string | Discount)[];
  ended_at?: number | null;
  cancellation_details?: { reason: string | null } | null;
};
type PreviousAttributes = {
  quantity?: number;
  items?: { data: { id: string; quantity?: number }[] };
};
type PaidInvoice = Stripe.Invoice & { subscription?: string | { id: string } | null };

function idOf(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function seatCount(items: { quantity?: number }[]): number | null {
  return items.length && items.every((item) => typeof item.quantity === "number")
    ? items.reduce((total, item) => total + item.quantity!, 0) : null;
}

function applyDiscounts(
  amounts: { amount: number; product: string }[],
  discounts: (string | Discount)[],
  currency: string,
): boolean {
  for (const discount of discounts) {
    if (typeof discount === "string") return false;
    const coupon = discount.coupon ?? discount.source?.coupon;
    if (!coupon || typeof coupon === "string") return false;
    const applicable = amounts.filter((line) => !coupon.applies_to || coupon.applies_to.products.includes(line.product));
    if (coupon.percent_off !== null) {
      for (const line of applicable) line.amount = Math.round(line.amount * (1 - coupon.percent_off / 100));
    } else if (coupon.amount_off !== null && (!coupon.currency || coupon.currency === currency)) {
      let remaining = coupon.amount_off;
      for (const line of applicable) {
        const reduction = Math.min(line.amount, remaining);
        line.amount -= reduction;
        remaining -= reduction;
      }
    }
  }
  return true;
}

export function subscriptionAnalyticsProperties(subscription: AnalyticsSubscription) {
  const items = subscription.items.data;
  const currency = items[0]?.price.currency ?? null;
  const sameCurrency = !!currency && items.every((item) => item.price.currency === currency);
  const interval = items[0]?.price.recurring?.interval;
  const amounts = items.map((item) => ({
    amount: Number(item.price.unit_amount_decimal ?? item.price.unit_amount) * (item.quantity ?? NaN),
    product: idOf(item.price.product)!,
  }));
  let amountKnown = sameCurrency && items.length > 0 && items.every((item, index) =>
    (item.price.unit_amount !== null || item.price.unit_amount_decimal != null) && Number.isFinite(amounts[index].amount));
  for (let index = 0; index < items.length && amountKnown; index++) {
    amountKnown = applyDiscounts([amounts[index]], items[index].discounts ?? [], currency!);
  }
  if (amountKnown) amountKnown = applyDiscounts(amounts, subscription.discounts ?? (subscription.discount ? [subscription.discount] : []), currency!);
  return {
    seats_after: seatCount(items),
    plan: items[0]?.price.id ?? null,
    interval: (interval === "month" || interval === "year") && items.every((item) => item.price.recurring?.interval === interval) ? interval : null,
    currency: sameCurrency ? currency : null,
    discounted_amount: amountKnown ? Math.round(amounts.reduce((total, line) => total + line.amount, 0)) : null,
  };
}

async function ownsOtherBilledTeam(userId: number, customerId: string): Promise<boolean> {
  return !!(await prisma.team.findFirst({
    where: { googleAccount: { userId }, stripe_customer_id: { not: null, notIn: [customerId] } },
    select: { id: true },
  }));
}

async function billedTeam(customerId: string | null) {
  const team = customerId ? await prisma.team.findFirst({
    where: { stripe_customer_id: customerId }, select: { id: true, googleAccount: { select: { userId: true } } },
  }) : null;
  if (!team) console.warn("[stripe-analytics] No stored customer mapping; analytics skipped");
  return team;
}

export function recordStripeSubscriptionEvent(
  event: Pick<Stripe.Event, "id" | "type" | "created">,
  subscription: AnalyticsSubscription,
  previousAttributes?: PreviousAttributes,
): void {
  scheduleAnalytics(async () => {
    const customerId = idOf(subscription.customer);
    const team = await billedTeam(customerId);
    if (!team || !(await isInviteSeatAnalyticsEnabled(team.googleAccount.userId))) return;
    const properties = subscriptionAnalyticsProperties(subscription);
    const canceled = event.type === "customer.subscription.deleted";
    const previousItems = previousAttributes?.items?.data.map((item) => ({
      quantity: item.quantity ?? subscription.items.data.find((current) => current.id === item.id)?.quantity,
    }));
    const seatsBefore = previousItems ? seatCount(previousItems) : previousAttributes?.quantity ?? null;
    if (!canceled && (event.type !== "customer.subscription.updated" || seatsBefore === null || properties.seats_after === null || seatsBefore === properties.seats_after)) return;
    if (canceled && !subscription.ended_at) return;
    const name = canceled ? "subscription_canceled" : "subscription_seats_changed";
    const eventId = `${name}:${canceled ? subscription.id : event.id}`;
    const userId = team.googleAccount.userId;
    const reason = subscription.cancellation_details?.reason;
    await captureAnalyticsOccurrence(userId, name, `analytics:${eventId}`, {
      ...serverAnalyticsProperties(userId, team.id, null, eventId, new Date((canceled ? subscription.ended_at! : event.created) * 1000)),
      ...properties, stripe_event_id: event.id, stripe_customer_id: customerId, subscription_id: subscription.id,
      seats_before: canceled ? properties.seats_after : seatsBefore, seats_after: canceled ? 0 : properties.seats_after,
      ...(canceled ? {
        canceled_at: new Date(subscription.ended_at! * 1000).toISOString(),
        cancellation_reason: reason && ["canceled_by_retention_policy", "cancellation_requested", "payment_disputed", "payment_failed"].includes(reason) ? reason : "unknown",
      } : {}),
    }, { scope: "business" });
  });
}

export type PaidInvoicePage = { data: PaidInvoice[]; has_more: boolean };

function invoiceSubscriptionId(invoice: PaidInvoice): string | null {
  return idOf(invoice.subscription ?? invoice.parent?.subscription_details?.subscription);
}

function paidTime(invoice: PaidInvoice): number {
  return invoice.status_transitions?.paid_at ?? invoice.created;
}

function paidInvoiceHistory(invoice: PaidInvoice, subscriptionId: string, page: PaidInvoicePage) {
  const positive = [invoice, ...page.data.filter((candidate) => candidate.id !== invoice.id)]
    .filter((candidate) => candidate.status === "paid" && candidate.amount_paid > 0);
  const earlier = positive.filter((candidate) => paidTime(candidate) < paidTime(invoice)
    || (paidTime(candidate) === paidTime(invoice) && candidate.id < invoice.id));
  const isFirstForSubscription = !page.has_more
    && !earlier.some((candidate) => invoiceSubscriptionId(candidate) === subscriptionId);
  const isFirstForCustomer = page.has_more ? null : !earlier.some((candidate) => invoiceSubscriptionId(candidate) !== null);
  return { isFirstForSubscription, isFirstForCustomer };
}

export function recordStripeInvoicePaid(
  event: Stripe.Event,
  retrieveSubscription: (id: string) => Promise<AnalyticsSubscription>,
  listPaidInvoices: (customerId: string) => Promise<PaidInvoicePage>,
): void {
  scheduleAnalytics(async () => {
    const invoice = event.data.object as PaidInvoice;
    if (invoice.status !== "paid" || invoice.amount_paid <= 0) return;
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;
    const customerId = idOf(invoice.customer);
    const team = await billedTeam(customerId);
    if (!team || !customerId || !(await isInviteSeatAnalyticsEnabled(team.googleAccount.userId))) return;
    const history = paidInvoiceHistory(invoice, subscriptionId, await listPaidInvoices(customerId));
    if (!history.isFirstForSubscription) return;
    const subscription = await retrieveSubscription(subscriptionId);
    if (idOf(subscription.customer) !== customerId || subscription.status !== "active") return;
    const properties = subscriptionAnalyticsProperties(subscription);
    if (properties.discounted_amount === null || properties.discounted_amount <= 0) return;
    const userId = team.googleAccount.userId;
    const eventId = `subscription_started:${subscriptionId}`;
    const paidAt = invoice.status_transitions.paid_at;
    let isFirstForUser = history.isFirstForCustomer;
    if (isFirstForUser && await ownsOtherBilledTeam(userId, customerId)) isFirstForUser = null;
    await captureAnalyticsOccurrence(userId, "subscription_started", `analytics:${eventId}`, {
      ...serverAnalyticsProperties(userId, team.id, null, eventId, new Date((paidAt ?? event.created) * 1000)),
      ...properties, stripe_event_id: event.id, stripe_customer_id: customerId, subscription_id: subscriptionId,
      seats_before: 0, invoice_id: invoice.id, amount_paid: invoice.amount_paid,
      paid_at: paidAt === null ? null : new Date(paidAt * 1000).toISOString(),
      is_first_subscription_for_user: isFirstForUser,
    }, { scope: "business" });
  });
}
