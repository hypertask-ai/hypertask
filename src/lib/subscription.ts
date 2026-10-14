import Stripe from "stripe";
import prisma from "@/lib/prisma";
import { IUser } from "@/models/model";
import {
  defaultStripeAmountMonth,
  defaultStripeAmountYear,
  isSubscriptionActive,
} from "./constants/constants";
import { allMonthlyPrices, allYearlyPrices } from "./subscriptionPlans";
import { planKindFromStripePriceId } from "./planFromStripePriceId";
import { stripeCustomerName } from "@/lib/stripeCustomerName";

export const stripe = new Stripe(String(process.env.STRIPE_SECRET_KEY), {
  apiVersion: "2023-08-16" as typeof Stripe.API_VERSION,
  maxNetworkRetries: 10,
  httpClient: Stripe.createFetchHttpClient(),
});

export type UpcomingInvoice = Stripe.Invoice;

export type PinnedApiVersionSubscription = Stripe.Response<Stripe.Subscription> & {
  current_period_start: number;
  current_period_end: number;
};

type InvoiceWithLegacyPaymentIntent = Stripe.Invoice & {
  payment_intent?: string | Stripe.PaymentIntent | null;
};

export interface InvoiceWithCardDetails {
  invoice: InvoiceWithLegacyPaymentIntent;
  cardDetails?: Stripe.Response<Stripe.PaymentMethod>;
}

export async function getUpcomingInvoice(
  customerId: string
): Promise<Stripe.Response<UpcomingInvoice> | null> {
  try {
    const upcomingInvoice = (await stripe.rawRequest(
      "GET",
      `/v1/invoices/upcoming?customer=${encodeURIComponent(customerId)}`
    )) as Stripe.Response<UpcomingInvoice>;
    console.log("🚀 ~ getUpcomingInvoice ~ upcomingInvoice:", upcomingInvoice);
    return upcomingInvoice;
  } catch (error) {
    return null;
  }
}

export async function getCustomer(
  customerId: string
): Promise<Stripe.Response<Stripe.Customer | any>> {
  const customer = await stripe.customers.retrieve(customerId);
  return customer;
}

export async function getInvoices(
  customerId: string
): Promise<InvoiceWithCardDetails[]> {
  try {
    const invoices = await stripe.invoices.list({
      customer: customerId,
    });

    const invoicesWithCardDetails: InvoiceWithCardDetails[] = [];

    for (const invoice of invoices.data) {
      if (invoice.amount_paid > 0) {
        const invoiceWithLegacyPaymentIntent = invoice as InvoiceWithLegacyPaymentIntent;
        const invoiceWithCardDetails: InvoiceWithCardDetails = {
          invoice: invoiceWithLegacyPaymentIntent,
        };

        if (invoiceWithLegacyPaymentIntent.payment_intent) {
          const paymentIntent = await stripe.paymentIntents.retrieve(
            invoiceWithLegacyPaymentIntent.payment_intent as string
          );

          if (paymentIntent.payment_method) {
            const paymentMethod = await stripe.customers.retrievePaymentMethod(
              customerId,
              paymentIntent.payment_method as string
            );
            const cardDetails = paymentMethod;

            invoiceWithCardDetails.cardDetails = cardDetails;
          }
        }

        invoicesWithCardDetails.push(invoiceWithCardDetails);
      }
    }

    return invoicesWithCardDetails;
  } catch (error) {
    console.error("Error retrieving invoices:", error);
    throw error;
  }
}

export async function hasSubscription(teamId: any) {
  const team = await prisma.team.findFirst({
    where: { id: teamId ?? undefined },
  });

  const PaidTeam = await prisma.team.findFirst({
    where: {
      stripe_customer_id: String(team?.stripe_customer_id),
    },
    include: {
      projects: {
        select: { id: true },
      },
      subscriptionPlan: {
        where: {
          subscriptionStatus: { not: "Expired" },
        },
      },
    },
  });

  const subscriptionCheck = await stripe.subscriptions.list({
    customer: String(team?.stripe_customer_id),
    status: "all",
  });

  const filteredSubscriptions = subscriptionCheck.data.find((sub) =>
    isSubscriptionActive(sub.status)
  );

  const monthlySubscription = filteredSubscriptions?.items.data.find(item => allMonthlyPrices.includes(item.price.id))
  const yearlySubscription = filteredSubscriptions?.items.data.find(item => allYearlyPrices.includes(item.price.id))

  const activeLine =
    monthlySubscription ??
    yearlySubscription ??
    filteredSubscriptions?.items.data[0];
  const { storePlanId: activeStorePlan, billingInterval: activeBillingInterval } =
    activeLine
      ? planKindFromStripePriceId(activeLine.price.id)
      : { storePlanId: "Free" as const, billingInterval: null };

  console.log("🚀 ~ hasSubscription ~ subscription:", filteredSubscriptions)

  if (!yearlySubscription && !monthlySubscription && PaidTeam)
    updateTeamInDBToExpired(String(team?.stripe_customer_id), PaidTeam.id);

  return {
    monthly: !!monthlySubscription,
    yearly: !!yearlySubscription,
    activeStorePlan,
    activeBillingInterval,
  };
}

export async function generateCustomerPortalLink(customerId: string) {
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.STRIPE_BILLING_PORTAL_LINK,
    });
    console.log(
      "🚀 ~ file: subscription.ts:54 ~ generateCustomerPortalLink ~ portalSession:",
      portalSession
    );

    return portalSession.url;
  } catch (error) {
    console.log(error);
    return undefined;
  }
}

export async function checkSubscriptionPlan(sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log("🚀 ~ checkSubscriptionPlan ~ session:", session.subscription);
    if (session.subscription && typeof session.subscription === 'string') {
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription
      );
      console.log("🚀 ~ checkSubscriptionPlan ~ subscription:", session);
      return subscription;
    }
    return undefined
  } catch (error: any) {
    console.log("🚀 ~ checkSubscriptionPlan ~ error:", error);
    return undefined;
  }
}

export async function checkTrialSuccess(sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log("🚀 ~ checkTrialSuccess ~ session:", session);
    const customer = (await stripe.customers.retrieve(
      session?.customer as string
    )) as Stripe.Customer;

    console.log("🚀 ~ checkTrialSuccess ~ customer:", customer);
    return customer.id;
  } catch (error: any) {
    console.log("🚀 ~ checkTrialSuccess ~ error:", error);
    return "";
  }
}

export async function findTeam(user: IUser) {
  try {
    if (user) {
      const team = await prisma.team.findFirst({
        where: {
          googleAccount: {
            userId: user.id,
          },
        },
        include: {
          projects: true,
          members: true,
          googleAccount: true,
          team_activity: true,
        },
      });
      console.log("🚀 ~ findTeam ~ team:", team);
      return team;
    }
    return undefined;
  } catch (error: any) {
    console.log("🚀 ~ findTeam ~ error:", error);
    return undefined;
  }
}

export async function createCustomerIfNull(
  _userEmail: string,
  teamId: string
): Promise<string | undefined> {
  if (!teamId) return undefined;

  const team = await prisma.team.findFirst({
    where: { id: teamId },
    select: { id: true, title: true, stripe_customer_id: true },
  });
  if (!team) {
    throw new Error(`createCustomerIfNull: team ${teamId} not found`);
  }
  if (team.stripe_customer_id) return team.stripe_customer_id;

  const customer = await stripe.customers.create(
    { name: stripeCustomerName(team.title), metadata: { teamId: team.id } },
    {
      idempotencyKey: `hypertask-team:${teamId}:stripe-customer`,
      maxNetworkRetries: 10,
    }
  );
  const claimed = await prisma.team.updateMany({
    where: { id: teamId, stripe_customer_id: null },
    data: { stripe_customer_id: customer.id },
  });
  if (claimed.count === 0) {
    const winner = await prisma.team.findFirst({
      where: { id: teamId },
      select: { stripe_customer_id: true },
    });
    return winner?.stripe_customer_id ?? undefined;
  }

  return customer.id;
}

export async function createInvoiceAndPay(
  customerId: string,
  interval: "year" | "month",
  currentPlanStatus: string | undefined,
  remainingTime?: number
) {
  const productId = String(process.env.NEXT_PUBLIC_STRIPE_PRODUCT_ID);

  if (currentPlanStatus === "active" || currentPlanStatus === "Paid") {
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "charge_automatically",
      description: `Billed for ${interval}ly subscription`,
    });
    console.log("🚀 ~ createInvoiceAndPay ~ invoice:", invoice);

    const amountToCharge =
      interval === "month"
        ? defaultStripeAmountMonth
        : remainingTime && remainingTime * defaultStripeAmountYear;
    console.log("🚀 ~ createInvoiceAndPay ~ amountToCharge:", amountToCharge);

    await stripe.invoiceItems.create({
      customer: customerId,
      price_data: {
        currency: "usd",
        product: productId,
        unit_amount: amountToCharge,
      },
      invoice: invoice.id,
    });

    const paymentMethods = await stripe.customers.listPaymentMethods(
      customerId
    );
    console.log(
      "🚀 ~ file: subscription.ts:178 ~ createInvoiceAndPay ~ paymentMethods:",
      paymentMethods
    );
    if (paymentMethods.data.length === 0) {
      return "Error";
    }

    const payment = await stripe.invoices.pay(invoice.id, {
      payment_method: paymentMethods.data[0].id,
    });
    console.log("🚀 ~ createInvoiceAndPay ~ payment:", payment);
    if (payment.status === "paid") {
      return "SEATED";
    }
  } else if (currentPlanStatus === "trialing") {
    return "SEATED";
  }

  return "Error";
}

const updateTeamInDBToExpired = async (stripeId: string, teamId: string) => {
  console.log("============> resetting to expired. ");
  await prisma.subscriptionPlan.updateMany({
    where: {
      teamId: teamId,
    },
    data: {
      subscriptionStatus: "Expired",
    },
  });
  await prisma.team.update({
    where: {
      id: teamId,
    },
    data: {
      activeSubscriptionPlanId: null,
      activeSubscriptionPlanItemId: null,
    },
  });
};
