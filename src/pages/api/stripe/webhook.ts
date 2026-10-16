import { Stripe } from "stripe";
import getRawBody from "raw-body";
import { NextApiRequest, NextApiResponse } from "next";
import sessionOnSuccess from "@/utils/controllers/stripe/webhook/onCheckoutSuccess";
import onSubscriptionUpdated from "@/utils/controllers/stripe/webhook/onSubscriptionUpdated";
import { recordStripeInvoicePaid, recordStripeSubscriptionEvent } from "@/lib/telemetry/stripeAnalytics";
import type { AnalyticsSubscription } from "@/lib/telemetry/stripeAnalytics";
import type { PinnedApiVersionSubscription } from "@/lib/subscription";

export const config = {
  api: {
    bodyParser: false,
  },
};
export enum StripeWebhooks {
  AsyncPaymentSuccess = "checkout.session.async_payment_succeeded",
  Completed = "checkout.session.completed",
  PaymentFailed = "checkout.session.async_payment_failed",
  SubscriptionDeleted = "customer.subscription.deleted",
  SubscriptionUpdated = "customer.subscription.updated",
  SubscriptionCreated = "customer.subscription.created",
  InvoicePaid = "invoice.paid",
}

function getStripeInstance() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return new Stripe(key, {
    apiVersion: "2023-08-16" as typeof Stripe.API_VERSION,
  });
}

export default async function checkoutsWebhooksHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const STRIPE_SIGNATURE_HEADER = "stripe-signature";
  const signature = req.headers[STRIPE_SIGNATURE_HEADER];
  const rawBody = await getRawBody(req);
  const stripe = await getStripeInstance();

  if (signature) {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.WEBHOOK_SECRET_STRIPE?.toString() ?? ""
    );
    console.log("🚀 ~ event:", event)
    try {
      switch (event.type) {
        case StripeWebhooks.InvoicePaid: {
          recordStripeInvoicePaid(
            event,
            (id) => stripe.subscriptions.retrieve(id),
            (customer) => stripe.invoices.list({ customer, status: "paid", limit: 100 }),
          );
          return res.status(200).json({ message: "success" });
        }

        case StripeWebhooks.SubscriptionCreated: {
          const subscription = await getSubscription(event);
          console.log("🚀 ~ file: webhook.ts:54 ~ subscription:", subscription )
          await sessionOnSuccess(subscription, subscription.plan);
          return res.status(200).json({ message: "success" });
          break;
        }

        case StripeWebhooks.Completed: {
          const session = event.data.object as Stripe.Checkout.Session;
          console.log("🚀 ~ file: webhook.ts:64 ~ session:", session)
          const subscriptionId = await getSubscriptionIdFromSession(event);
          const subscription: any = await stripe.subscriptions.retrieve(
            subscriptionId
          );
          await sessionOnSuccess(subscription, subscription.plan);
          return res.status(200).json({ message: "success" });
        }
        case StripeWebhooks.AsyncPaymentSuccess: {
          const session = event.data.object as Stripe.Checkout.Session;
          const organizationId = session.client_reference_id as string;


          break;
        }

        case StripeWebhooks.SubscriptionDeleted: {
          const subscription = event.data
            .object as PinnedApiVersionSubscription;
          console.log("🚀 ~ subscription:", subscription);
          await onSubscriptionUpdated(subscription);
          recordStripeSubscriptionEvent(event, event.data.object as unknown as AnalyticsSubscription);
          return res.status(200).json({ message: "success" });
        }

        case StripeWebhooks.SubscriptionUpdated: {
          const subscription = await getSubscription(event);
          console.log("🚀 ~ subscription:", subscription);
          await onSubscriptionUpdated(subscription, subscription.plan);
          recordStripeSubscriptionEvent(event, event.data.object as unknown as AnalyticsSubscription, event.data.previous_attributes);
          return res.status(200).json({ message: "success" });

          break;
        }

        case StripeWebhooks.PaymentFailed: {
          const session = event.data.object as Stripe.Checkout.Session;
          console.log("🚀 ~ file: webhook.ts:87 ~ session:", session);


          break;
        }
      }
      return res.status(200).json({ message: "success" });
    } catch (e) {
      console.log(e);
      return res.status(500).json(e);
    }
  }


  async function getSubscription(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;
    console.log("🚀 ~ file: webhook.ts:57 ~ session:", session);
    const subscriptionId = session.id as string;
    console.log("🚀 ~ getSubscription ~ subscriptionId:", subscriptionId);

    const subscription: any = await stripe.subscriptions.retrieve(
      subscriptionId
    );
    console.log("🚀 ~ getSubscription ~ subscription:", subscription);
    return subscription;
  }

  async function getSubscriptionIdFromSession(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = session.subscription as string;
    console.log("🚀 ~ getSubscriptionIdFromSession ~ subscriptionId:", subscriptionId);
    return subscriptionId;
  }
}
