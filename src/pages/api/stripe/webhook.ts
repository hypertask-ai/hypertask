import { Stripe } from "stripe";
import getRawBody from "raw-body";
import { NextApiRequest, NextApiResponse } from "next";
import sessionOnSuccess from "@/utils/controllers/stripe/webhook/onCheckoutSuccess";
import onSubscriptionUpdated from "@/utils/controllers/stripe/webhook/onSubscriptionUpdated";
import prisma from "@/lib/prisma";
import { enqueueAnalyticsIntent, processAnalyticsIntentSoon } from "@/lib/telemetry/analyticsIntents";
import type { PinnedApiVersionSubscription } from "@/lib/subscription";
import { logRecord, recordId } from "@/lib/logging/safeLog";

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

  const secret = process.env.WEBHOOK_SECRET_STRIPE;
  if (!secret) {
    console.error("[stripe-webhook] WEBHOOK_SECRET_STRIPE is not configured");
    return res.status(500).json({ message: "webhook secret is not configured" });
  }

  if (signature) {
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      console.error(
        "[stripe-webhook] signature verification failed:",
        error instanceof Error ? error.message : error
      );
      return res.status(400).json({ message: "invalid signature" });
    }
    try {
      switch (event.type) {
        case StripeWebhooks.InvoicePaid: {
          const key = await enqueueAnalyticsIntent(prisma, { kind: "stripe_event", payload: { eventId: event.id } });
          processAnalyticsIntentSoon(key);
          return res.status(200).json({ message: "success" });
        }

        case StripeWebhooks.SubscriptionCreated: {
          const subscription = await getSubscription(event);
          logRecord("stripe webhook subscription", {
            subscriptionId: recordId(subscription?.id),
            customerId: recordId(subscription?.customer),
            outcome: "created",
          }, subscription)
          await sessionOnSuccess(subscription, subscription.plan);
          return res.status(200).json({ message: "success" });
          break;
        }

        case StripeWebhooks.Completed: {
          const session = event.data.object as Stripe.Checkout.Session;
          logRecord("stripe webhook session", {
            sessionId: recordId(session?.id),
            customerId: recordId(session?.customer),
            subscriptionId: recordId(session?.subscription),
            outcome: "completed",
          }, session)
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
          logRecord("stripe webhook subscription", {
            subscriptionId: recordId(subscription?.id),
            customerId: recordId(subscription?.customer),
            outcome: "deleted",
          }, subscription);
          await onSubscriptionUpdated(subscription);
          try {
            const key = await enqueueAnalyticsIntent(prisma, { kind: "stripe_event", payload: { eventId: event.id } });
            processAnalyticsIntentSoon(key);
          } catch {
            console.error("[stripe-analytics] intent enqueue failed");
          }
          return res.status(200).json({ message: "success" });
        }

        case StripeWebhooks.SubscriptionUpdated: {
          const subscription = await getSubscription(event);
          logRecord("stripe webhook subscription", {
            subscriptionId: recordId(subscription?.id),
            customerId: recordId(subscription?.customer),
            outcome: "updated",
          }, subscription);
          await onSubscriptionUpdated(subscription, subscription.plan);
          try {
            const key = await enqueueAnalyticsIntent(prisma, { kind: "stripe_event", payload: { eventId: event.id } });
            processAnalyticsIntentSoon(key);
          } catch {
            console.error("[stripe-analytics] intent enqueue failed");
          }
          return res.status(200).json({ message: "success" });

          break;
        }

        case StripeWebhooks.PaymentFailed: {
          const session = event.data.object as Stripe.Checkout.Session;
          logRecord("stripe webhook session", {
            sessionId: recordId(session?.id),
            customerId: recordId(session?.customer),
            subscriptionId: recordId(session?.subscription),
            outcome: "payment-failed",
          }, session);


          break;
        }
      }
      return res.status(200).json({ message: "success" });
    } catch (e) {
      console.log(e);
      return res.status(500).json(e);
    }
  }

  return res.status(400).json({ message: "missing signature" });


  async function getSubscription(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;
    logRecord("stripe webhook session", {
      sessionId: recordId(session?.id),
      customerId: recordId(session?.customer),
      outcome: "subscription-lookup",
    }, session);
    const subscriptionId = session.id as string;
    console.log("🚀 ~ getSubscription ~ subscriptionId:", subscriptionId);

    const subscription: any = await stripe.subscriptions.retrieve(
      subscriptionId
    );
    logRecord("stripe webhook subscription", {
      subscriptionId: recordId(subscription?.id),
      customerId: recordId(subscription?.customer),
      outcome: "retrieved",
    }, subscription);
    return subscription;
  }

  async function getSubscriptionIdFromSession(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = session.subscription as string;
    console.log("🚀 ~ getSubscriptionIdFromSession ~ subscriptionId:", subscriptionId);
    return subscriptionId;
  }
}
