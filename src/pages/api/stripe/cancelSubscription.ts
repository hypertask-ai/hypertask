import { stripe } from "@/lib/subscription";
import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export default async function checkoutsSessionHandler(
    req: NextApiRequest,
    res: NextApiResponse
  ) {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const {  stripe_customer_id } =req.body;
    const team = await prisma.team.findFirst({
      where: {
        stripe_customer_id:
          typeof stripe_customer_id === "string" ? stripe_customer_id : "",
        googleAccount: { userId: session.userId },
      },
      select: { id: true },
    });
    if (!team) {
      return res.status(403).json({ message: "Forbidden" });
    }
    console.log("🚀 ~ file: checkout.ts:9 ~ req.body:", req.body)
   
    try {
        const monthlySubscription = await stripe.subscriptions.list({
            customer: stripe_customer_id ,
            price:process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID,
            status:"active"
        })
        console.log("🚀 ~ file: cancelSubscription.ts:24 ~ monthlySubscription:", monthlySubscription)
        if (monthlySubscription.data.length>0){
            for (const subscription of monthlySubscription.data){
                await stripe.subscriptions.cancel(subscription.id)
                console.log("Cancelled all monthly subscriptions")
            }
        }

        const yearlySubscription = await stripe.subscriptions.list({
            customer: stripe_customer_id,
            price:process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID,
            status:"active"
        })
        
        if (yearlySubscription.data.length>0){
            for (const subscription of yearlySubscription.data){
                const cancelled_subscription = await stripe.subscriptions.cancel(subscription.id)
                console.log("🚀 ~ file: cancelSubscription.ts:46 ~ cancelled_subscription:",cancelled_subscription)
                console.log("Cancelled all yearly subscriptions")

            }
        }


        console.log("🚀 ~ file: cancelSubscription.ts:35 ~ yearlySubscription:", yearlySubscription)
      return res.status(200).json({message:"Success"});
    } catch (e) {
      console.error(e, `Stripe  error`);
   
      return res.status(500).end();
    }
  }