import { CreateCheckoutParams } from "@/models/model";
import Stripe from "stripe";

export function getStripeInstance() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";

  return new Stripe(key, {
    // Deliberately pinned; account/webhook payload shapes depend on it.
    apiVersion: "2023-08-16" as typeof Stripe.API_VERSION,
  });
}

// Subscription statuses where the customer is (or will be) billed for the plan.
// We deliberately exclude "incomplete"/"incomplete_expired"/"canceled" so a user
// can still retry after an abandoned or failed first attempt.
const LIVE_SUBSCRIPTION_STATUSES: Stripe.Subscription.Status[] = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
];

export function isLiveSubscription(subscription: Stripe.Subscription): boolean {
  return LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
}

// Returns an existing live subscription for the same price, if any. Used to stop
// a customer from creating a second identical subscription (and a second charge)
// when they already have one. Pure function so it can be checked in isolation.
export function findActiveDuplicateSubscription(
  subscriptions: Stripe.Subscription[],
  priceId: string,
): Stripe.Subscription | undefined {
  return subscriptions.find(
    (sub) =>
      isLiveSubscription(sub) &&
      sub.items.data.some((item) => item.price.id === priceId),
  );
}

export async function createStripeCheckout(
  params: CreateCheckoutParams,
  requestOptions?: Stripe.RequestOptions,
) {
  const customer = params.stripe_customer_id || undefined;
  // console.log("🚀 ~ file: stripe.ts:20 ~ createStripeCheckout ~ customer:", customer)
  const mode: Stripe.Checkout.SessionCreateParams.Mode = "subscription";

  const stripe = await getStripeInstance();
  // console.log("🚀 ~ file: stripe.ts:24 ~ createStripeCheckout ~ stripe:", stripe)

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
    quantity: params.quantity,
    price: params.priceId,
    adjustable_quantity: {
      enabled: true,
      minimum: params.quantity,
    },
  };

  const successUrl = params.returnUrl;
  const cancelUrl = params.cancelUrl;
  if (params.mode === "Trial") {
    return stripe.checkout.sessions.create(
      {
        mode,
        customer,
        line_items: [lineItem],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        payment_method_collection: "always",
        subscription_data: {
          trial_period_days: 14,
          trial_settings: {
            end_behavior: {
              missing_payment_method: "create_invoice",
            },
          },
        },
        metadata: params.metadata || {},
      },
      requestOptions,
    );
  } else {
    return stripe.checkout.sessions.create(
      {
        mode,
        customer,
        line_items: [lineItem],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        payment_method_collection: "always",
        metadata: params.metadata || {},
      },
      requestOptions,
    );
  }
}
