// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    // ================== get request body
    const {taskId} = req.query;
    if (!taskId) return res.status(400).json({message:"Missing Required Information"})
    const task = await prisma.task.findFirst({
        where: { id: parseInt(taskId as string), project: projectContentAccessWhere(session.userId) },
        select: { id: true },
    });
    if (!task) return res.status(404).json({ message: "Task not found" });
    // ================== find all labels associated with that projectId
    const taskLabels = await prisma.taskLabel.findMany({
        where:{
            taskId:parseInt(taskId as string)
        },
        include:{label:true}
    })
    return res.status(200).json(taskLabels)

}
