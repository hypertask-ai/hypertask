import { env as appEnv } from "#env";
import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { stripe } from "@/lib/subscription";
import { NextApiRequest, NextApiResponse } from "next";

async function checkoutsSessionHandler(
    req: NextApiRequest,
    res: NextApiResponse
  ) {
    const {  stripe_customer_id } =req.body;
    htLogger.info("🚀 ~ file: checkout.ts:9 ~ req.body:", req.body)
   
    // NB: here you may want to check that:
    // - the user can update billing
    // - the data sent is correct
    // - the user belongs to the organization in the body
    // we omit it for simplicity, but food for thought!
    // we also look for the 
    try {
    // ===================================== check monthly subscription for that user.
        const monthlySubscription = await stripe.subscriptions.list({
            // customer: 'cus_PHFSdkieUkWw5t',
            customer: stripe_customer_id ,
            price:appEnv.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID,
            status:"active"
        })
        htLogger.info("🚀 ~ file: cancelSubscription.ts:24 ~ monthlySubscription:", monthlySubscription)
        // ==================== cancel all the subscriptions
        if (monthlySubscription.data.length>0){
            for (const subscription of monthlySubscription.data){
                await stripe.subscriptions.cancel(subscription.id)
                htLogger.info("Cancelled all monthly subscriptions")
            }
        }

    // ===================================== check yearly subscription for that user.
        const yearlySubscription = await stripe.subscriptions.list({
            // customer: 'cus_PHFSdkieUkWw5t',
            customer: stripe_customer_id,
            price:appEnv.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID,
            status:"active"
        })
        
        // ==================== cancel all the subscriptions
        if (yearlySubscription.data.length>0){
            for (const subscription of yearlySubscription.data){
                const cancelled_subscription = await stripe.subscriptions.cancel(subscription.id)
                htLogger.info("🚀 ~ file: cancelSubscription.ts:46 ~ cancelled_subscription:",cancelled_subscription)
                htLogger.info("Cancelled all yearly subscriptions")

            }
        }


        htLogger.info("🚀 ~ file: cancelSubscription.ts:35 ~ yearlySubscription:", yearlySubscription)
      // redirect user back based on the response
      return res.status(200).json({message:"Success"});
    } catch (e) {
      htLogger.error(e, `Stripe  error`);
   
      // either end request or ideally redirect users to the same URL
      // but using a query parameter such as error=true
      return res.status(500).end();
    }
  }

export default withAuth(checkoutsSessionHandler, { authenticateInHandler: true });
