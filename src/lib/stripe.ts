import { CreateCheckoutParams } from "@/models/model";
import Stripe from "stripe";

export function getStripeInstance() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";

  return new Stripe(key, {
    apiVersion: "2023-08-16" as typeof Stripe.API_VERSION,
  });
}

const LIVE_SUBSCRIPTION_STATUSES: Stripe.Subscription.Status[] = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
];

export function isLiveSubscription(subscription: Stripe.Subscription): boolean {
  return LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
}

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
  const mode: Stripe.Checkout.SessionCreateParams.Mode = "subscription";

  const stripe = await getStripeInstance();

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
