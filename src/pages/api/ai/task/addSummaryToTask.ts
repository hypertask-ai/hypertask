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
    
    const {taskId, summaryMarkDown} = req.body;
    htLogger.info("Recieved summary from flask: ",summaryMarkDown )
    if (!taskId || !summaryMarkDown ) return res.status(400).json({message:"Missing required info"})
    
    if (req.method==="POST"){
      const existingTaskSummary = await prisma.task_Summary.findUnique({
        where: { taskId }
    });
    
    let task_Summary;
    
    if (existingTaskSummary) {
        // Update the existing task summary
        task_Summary = await prisma.task_Summary.update({
            where: { taskId },
            data: {
                updatedAt: new Date(),
                content: summaryMarkDown,
            },
            include: { task: true }
        });
    } else {
        // Create a new task summary
        task_Summary = await prisma.task_Summary.create({
            data: {
                updatedAt: new Date(),
                content: summaryMarkDown,
                taskId,
                
            },
            include: { task: true }
        });
    }
    htLogger.info("summary generated for task: ", summaryMarkDown)
        return res.status(200).json({message:`Ai summary for task:${task_Summary.task.title} added successfully`})
    }
    else return res.status(405).json({message:"Only POST method allowed"})
        
  } catch (error) {
      htLogger.info(error)
      return res.status(500).json(error)
  }
}

export default withAuth(handler, { authenticateInHandler: true });
