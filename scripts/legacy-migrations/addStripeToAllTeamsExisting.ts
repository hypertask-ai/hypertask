// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { stripe } from '@/lib/subscription';

import type { NextApiRequest, NextApiResponse } from 'next'

type Data = {
  name: string
}
import prisma from "@/lib/prisma";


export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  
    console.log("getting all teams")
    // ===================== GET ALL TEAMS

    const teams = await prisma.team.findMany()

    for (const team of teams){
        console.log("🚀 ~ file: addStripeToAllTeamsExisting.ts:22 ~ team:", team)
        // if (!team.stripe_customer_id){
            const customer = await stripe.customers.create({
                name: team.title + `${team.id}`
            })
            console.log("🚀 ~ file: addStripeToAllTeamsExisting.ts:27 ~ customer:", customer)
            await prisma.team.update({
                where:{
                    id:team.id
                },
                data:{
                    stripe_customer_id:customer.id
                }
            })
        // }
    }
  res.status(200).json({ name: 'John Doe' })
}
