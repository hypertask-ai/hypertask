import type Stripe from "stripe";
import { getStripeInstance } from "@/lib/stripe";
import { storeSubscriptionPlans } from "@/lib/subscriptionPlans";

export function billingPortalPriceIds(): string[] {
  const prices = storeSubscriptionPlans
    .filter((plan) => plan.id === "Pro" || plan.id === "BYOK")
    .flatMap((plan) => plan.types.map((type) => type.stripePriceId));
  if (prices.length !== 4 || new Set(prices).size !== 4 || prices.some((price) => !price?.startsWith("price_"))) {
    throw new Error("Billing portal prices are not configured");
  }
  return prices.filter((price): price is string => typeof price === "string");
}

export function billingPortalConfiguration(
  products: Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[],
): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    name: "HTPR-7980 billing",
    metadata: { ticket: "HTPR-7980" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        products,
        proration_behavior: "create_prorations",
        billing_cycle_anchor: "unchanged",
        trial_update_behavior: "continue_trial",
        schedule_at_period_end: { conditions: [] },
      },
    },
  };
}

export function assertBillingPortalConfiguration(
  configuration: Stripe.BillingPortal.Configuration,
  priceIds: string[],
): void {
  const features = configuration.features;
  const update = features.subscription_update;
  const configuredPrices = update.products?.flatMap((product) => product.prices) ?? [];
  if (!configuration.active || configuration.is_default ||
    configuration.metadata?.ticket !== "HTPR-7980" ||
    !features.invoice_history.enabled || !features.payment_method_update.enabled ||
    !features.customer_update.enabled ||
    features.customer_update.allowed_updates.length !== 1 ||
    features.customer_update.allowed_updates[0] !== "email" ||
    !features.subscription_cancel.enabled || features.subscription_cancel.mode !== "at_period_end" ||
    !update.enabled || update.default_allowed_updates.length !== 1 ||
    update.default_allowed_updates[0] !== "price" ||
    update.products?.some((product) => product.adjustable_quantity?.enabled) ||
    priceIds.length !== configuredPrices.length ||
    priceIds.some((price) => !configuredPrices.includes(price)) ||
    update.proration_behavior !== "create_prorations" ||
    update.billing_cycle_anchor !== "unchanged" ||
    update.trial_update_behavior !== "continue_trial" ||
    (update.schedule_at_period_end?.conditions.length ?? 0) !== 0) {
    throw new Error("Billing portal configuration does not match the approved policy");
  }
}

export async function createConfiguredBillingPortalSession(customerId: string) {
  const configurationId = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim();
  if (!configurationId?.startsWith("bpc_")) {
    throw new Error("Dedicated billing portal configuration is required");
  }
  const stripe = getStripeInstance();
  const configuration = await stripe.billingPortal.configurations.retrieve(configurationId, {
    expand: ["features.subscription_update.products"],
  });
  assertBillingPortalConfiguration(configuration, billingPortalPriceIds());
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    configuration: configurationId,
    return_url: new URL("/settings/billing", process.env.NEXT_PUBLIC_BASEURL).href,
  });
}
