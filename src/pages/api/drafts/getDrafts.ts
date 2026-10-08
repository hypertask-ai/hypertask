// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import getDraftsController from '@/utils/controllers/drafts/getDraftsController';
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
    
  try {
    if (req.method!=="POST")return
    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    const {taskId} = req.body;
    const userId = session.userId;
    if (!taskId) return res.status(400).json({message:"Missing TaskId"})

    const task = await prisma.task.findFirst({
      where: { id: Number(taskId), project: projectContentAccessWhere(userId) },
      select: { id: true },
    });
    if (!task) return res.status(404).json({ message: "Task not found" });
    const drafts = await getDraftsController(task.id, userId)
    // console.log("🚀 ~ drafts:", drafts)
    return res.status(200).json(drafts)
    
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
