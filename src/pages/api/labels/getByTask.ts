// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
    // ================== get request body
    const {taskId} = req.query;
    if (!taskId) return res.status(400).json({message:"Missing Required Information"})
    // ================== find all labels associated with that projectId
    const taskLabels = await prisma.taskLabel.findMany({
        where:{
            taskId:parseInt(taskId as string)
        },
        include:{label:true}
    })
    return res.status(200).json(taskLabels)

}
