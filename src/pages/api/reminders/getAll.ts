import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";



async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    const {userId} = req.query
    htLogger.info("🚀 ~ userId:", userId)
    const reminders = await prisma.reminder.findMany({
        where:{
            userId:parseInt(userId as string),
            status:"Normal"
            
        },
        include:{
            task:{
                include:{
                    project:true,
                    user:true
                }
            }
        },
        orderBy:{
            createdAt:"desc"
        },
        distinct:["taskId"]
    })
    htLogger.info("🚀 ~ reminders:", reminders)
    return res.status(200).json(reminders)
  } catch (error) {
      htLogger.info(error)
      return res.status(500).json(error)
  }
}

export default withAuth(handler, { authenticateInHandler: true });
