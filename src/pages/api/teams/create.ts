import { stripe } from "@/lib/subscription";
import { CreateLogInput } from "@/models/model";
import createLog from "@/utils/controllers/logs/createLog";
import { LogType, PrismaClient, Status } from "@prisma/client";

import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    try {
            const {userId, teamTitle} = req.body
            const googleAccountId = await prisma.googleAccount.findFirst({
                where:{
                    userId:userId
                },

            })
            if (!userId || !teamTitle || !googleAccountId){
                return res.status(304).json({message:"Missing Required Information"})
            }

            const Team = await prisma.team.create({
                data:{
                    title:teamTitle,
                    googleAccountId:googleAccountId.id,
                    totalSeats:1,
                },             
            })
            await prisma.team_Activity.create({
                data:{
                    lastActiviyAt:new Date(),
                    teamId:Team.id,
                }
            })
            
            await prisma.user_Activity.update({
                where:{userId},
                data:{totalTeamsOwned:{increment:1}}
            })
            const user= await prisma.user.findUnique({
                where:{
                    id:userId   
                }
            })

            let logBody:CreateLogInput = {
                log:`${user?.displayName} created a Team "${teamTitle}" `,
                type:LogType.Team,
                status:Status.Normal,
                LoggedById:userId
              }
              createLog(logBody)
        // =================== CREATE stripe customer 
            const customer = await stripe.customers.create({
                name: Team.title + `${Team.id}`
            })
            await prisma.team.update({
                where:{
                    id:Team.id
                },
                data:{
                    stripe_customer_id:customer.id
                }
            })
            
            return res.status(200).json(Team)
        } catch (error) {
            console.log(error);
            return ({
                status:400,
                json:[]
            })
        }

};

export default handler;