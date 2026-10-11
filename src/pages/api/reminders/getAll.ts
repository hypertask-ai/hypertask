// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const reminders = await prisma.reminder.findMany({
        where:{
            userId: session.userId,
            status:"Normal",
            task: { project: projectContentAccessWhere(session.userId) },
            
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
