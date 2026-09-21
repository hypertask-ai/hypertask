// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    const {userId} = req.query
    console.log("🚀 ~ userId:", userId)
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
    console.log("🚀 ~ reminders:", reminders)
    return res.status(200).json(reminders)
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
