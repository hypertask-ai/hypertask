import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import {
  getCustomer,
  getInvoices,
  getUpcomingInvoice,
  stripe,
} from "@/lib/subscription";
import hasTeamOwnerOrProjectAdminAccess from "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess";
import { emailPattern } from "@/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StripeCustomerResponse = Stripe.Response<
  Stripe.Customer | Stripe.DeletedCustomer
>;

const getStripeCustomerEmail = (customer: StripeCustomerResponse) => {
  if ("deleted" in customer && customer.deleted) return null;
  return customer.email ?? null;
};

// Billing hangs off Team.stripe_customer_id (not User.stripe_customer_id —
// that field belongs to a separate, unrelated flow). A project admin may
// view/edit billing for their project's team; only the team owner may
// mutate the subscription itself (cancel, payment method — see
// /api/stripe/billing-portal, left owner-only).
const hasBillingAccess = hasTeamOwnerOrProjectAdminAccess;

export async function GET(request: Request) {
  const user = await getServerCookieUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const teamId = url.searchParams.get("teamId")?.trim();
  const projectId = url.searchParams.get("projectId")?.trim();

  if (!teamId) {
    return NextResponse.json({ message: "teamId required" }, { status: 400 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      googleAccount: { select: { userId: true } },
      googleAccountId: true,
      stripe_customer_id: true,
    },
  });

  if (!team) {
    return NextResponse.json({ message: "Team not found" }, { status: 404 });
  }

  const hasAccess = await hasBillingAccess(
    user.id,
    user.accountId,
    team,
    teamId,
    projectId ?? null
  );

  if (!hasAccess) {
    return NextResponse.json(
      { message: "Only the team owner or a board admin can view billing details" },
      { status: 403 }
    );
  }

  if (!team.stripe_customer_id) {
    return NextResponse.json({
      customerEmail: null,
      invoices: [],
      upcomingInvoice: null,
    });
  }

  try {
    const [customer, invoices, upcomingInvoice] = await Promise.all([
      getCustomer(team.stripe_customer_id) as Promise<StripeCustomerResponse>,
      getInvoices(team.stripe_customer_id),
      getUpcomingInvoice(team.stripe_customer_id),
    ]);

    return NextResponse.json({
      customerEmail: getStripeCustomerEmail(customer),
      invoices: invoices.map(({ cardDetails, invoice }) => ({
        amountPaid: invoice.amount_paid,
        cardBrand: cardDetails?.card?.brand ?? null,
        cardLast4: cardDetails?.card?.last4 ?? null,
        created: invoice.created,
        currency: invoice.currency,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        id: invoice.id ?? invoice.number ?? String(invoice.created),
        paymentMethodType: cardDetails?.type ?? null,
        status: invoice.status,
      })),
      upcomingInvoice: upcomingInvoice
        ? {
            amountDue: upcomingInvoice.amount_due,
            // subtotal = full list price before any coupon; discountTotal is
            // the summed coupon amount. Lets Settings show the account's real
            // size (e.g. a negotiated flat-rate team) while amountDue stays the
            // actual charge. Zero discount for normal teams => reads as one price.
            subtotal: upcomingInvoice.subtotal,
            discountTotal: (upcomingInvoice.total_discount_amounts ?? []).reduce(
              (sum, item) => sum + (item.amount ?? 0),
              0
            ),
            created: upcomingInvoice.created,
            currency: upcomingInvoice.currency,
            nextPaymentAttempt: upcomingInvoice.next_payment_attempt ?? null,
            periodEnd: upcomingInvoice.period_end ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("Error loading settings billing data:", error);
    return NextResponse.json(
      { message: "Could not load billing details" },
      { status: 500 }
    );
  }
}

// Updates the Stripe customer's email — a plain accounting/invoicing address,
// not tied to any board member or Hypertask user. Stripe sends invoices and
// receipts to this address.
export async function POST(request: Request) {
  const user = await getServerCookieUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: { teamId?: unknown; projectId?: unknown; billingEmail?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request" }, { status: 400 });
  }

  const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
  const projectId =
    typeof body.projectId === "string" || typeof body.projectId === "number"
      ? String(body.projectId).trim()
      : null;
  const billingEmail =
    typeof body.billingEmail === "string" ? body.billingEmail.trim() : "";

  if (!teamId) {
    return NextResponse.json({ message: "teamId required" }, { status: 400 });
  }

  if (!billingEmail.match(emailPattern)) {
    return NextResponse.json({ message: "Invalid email address" }, { status: 400 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      googleAccount: { select: { userId: true } },
      googleAccountId: true,
      stripe_customer_id: true,
    },
  });

  if (!team) {
    return NextResponse.json({ message: "Team not found" }, { status: 404 });
  }

  const hasAccess = await hasBillingAccess(
    user.id,
    user.accountId,
    team,
    teamId,
    projectId
  );

  if (!hasAccess) {
    return NextResponse.json(
      { message: "Only the team owner or a board admin can update billing" },
      { status: 403 }
    );
  }

  if (!team.stripe_customer_id) {
    return NextResponse.json({ message: "No billing account" }, { status: 400 });
  }

  try {
    await stripe.customers.update(team.stripe_customer_id, {
      email: billingEmail,
    });
    return NextResponse.json({ billingEmail });
  } catch (error) {
    console.error("Error updating billing email:", error);
    return NextResponse.json(
      { message: "Could not update billing email" },
      { status: 500 }
    );
  }
}
