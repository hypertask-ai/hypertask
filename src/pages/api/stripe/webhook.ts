import { Stripe } from "stripe";
import getRawBody from "raw-body";
import { NextApiRequest, NextApiResponse } from "next";
import sessionOnSuccess from "@/utils/controllers/stripe/webhook/onCheckoutSuccess";
import onSubscriptionUpdated from "@/utils/controllers/stripe/webhook/onSubscriptionUpdated";
import type { PinnedApiVersionSubscription } from "@/lib/subscription";
// import { getStripeInstance } from '@/lib/stripe';
// import Stripe from "stripe";

// NB: we disable body parser to receive the raw body string. The raw body
// is fundamental to verify that the request is genuine
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
}

function getStripeInstance() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return new Stripe(key, {
    // Deliberately pinned; account/webhook payload shapes depend on it.
    apiVersion: "2023-08-16" as typeof Stripe.API_VERSION,
  });
}

export default async function checkoutsWebhooksHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const STRIPE_SIGNATURE_HEADER = "stripe-signature";
  // console.log("🚀 ~ file: webhook.ts:38 ~ STRIPE_SIGNATURE_HEADER:", STRIPE_SIGNATURE_HEADER)
  const signature = req.headers[STRIPE_SIGNATURE_HEADER];
  // console.log("🚀 ~ file: webhook.ts:40 ~ signature:", signature)
  const rawBody = await getRawBody(req);
  // console.log("🚀 ~ file: webhook.ts:42 ~ rawBody:", rawBody)
  const stripe = await getStripeInstance();

  if (signature) {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.WEBHOOK_SECRET_STRIPE?.toString() ?? ""
    );
    console.log("🚀 ~ event:", event)
    // console.log("🚀 ~ file: webhook.ts:55 ~ event.type:", event.type)
    try {
      switch (event.type) {
        case StripeWebhooks.SubscriptionCreated: {
          const subscription = await getSubscription(event);
          console.log("🚀 ~ file: webhook.ts:54 ~ subscription:", subscription )
          await sessionOnSuccess(subscription, subscription.plan);
          // await onCheckoutCompleted(session, subscription);
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

          // await activatePendingSubscription(organizationId);

          break;
        }

        case StripeWebhooks.SubscriptionDeleted: {
          // Stripe sends the final Subscription object with this event. Do not
          // retrieve a deleted object again: process the signed event payload
          // and revoke the matching team's entitlement immediately.
          const subscription = event.data
            .object as PinnedApiVersionSubscription;
          console.log("🚀 ~ subscription:", subscription);
          await onSubscriptionUpdated(subscription);
          return res.status(200).json({ message: "success" });
        }

        case StripeWebhooks.SubscriptionUpdated: {
          const subscription = await getSubscription(event);
          console.log("🚀 ~ subscription:", subscription);
          await onSubscriptionUpdated(subscription, subscription.plan);
          return res.status(200).json({ message: "success" });

          break;
        }

        case StripeWebhooks.PaymentFailed: {
          const session = event.data.object as Stripe.Checkout.Session;
          console.log("🚀 ~ file: webhook.ts:87 ~ session:", session);

          // TODO: handle this properly
          // onPaymentFailed(session);

          break;
        }
      }
      return res.status(200).json({ message: "success" });
      // return respondOk(res);
    } catch (e) {
      //   return internalServerErrorException(res);
      console.log(e);
      return res.status(500).json(e);
    }
  }

  // NB: if stripe.webhooks.constructEvent fails, it would throw an error

  // here we handle each event based on {event.type}
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
