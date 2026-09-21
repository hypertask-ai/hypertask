// Import PrismaClient from the generated Prisma client
import sectionGetByTask from '@/utils/controllers/section/getByTask';

import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from '@/lib/realtime/server';
import { taskWriteAccessWhere } from '@/utils/controllers/projects/getAllIncludes';


// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
if (req.method==="POST"){

    const { taskIds, agentId } = req.body;
    const currentUser = JSON.parse(req.cookies.nookies_user!);
    console.log("🚀 ~ file: resetRanks.ts:14 ~ consthandler:NextApiHandler= ~ taskIds:", taskIds)
    if (!taskIds) {
      return res.status(400).json({ message: "Missing TaskId" });
  }
  try {
    // Get all sections
    // const sections = await prisma.section.findMany({
    //     where:{
    //         projectId:projectId,
    //         deleted:false,
    //     },
    //     orderBy:{
    //       ranking:"asc"
    //     }

    // });
    let currentRank = 100; // Initialize with 100
    const uniqueTaskIds = Array.from(new Set(taskIds)) as number[];
    const projectIds = await prisma.task.findMany({
      where: {
        id: { in: uniqueTaskIds },
        project: taskWriteAccessWhere(currentUser.id, agentId),
      },
      select: { projectId: true },
    });
    if (projectIds.length !== uniqueTaskIds.length) {
      return res.status(404).json({ message: "Task not found or access denied" });
    }

    for (const task of taskIds) {
      try {
        await prisma.task.update({
          where: { id: task },
          data: { ranking: `A${currentRank.toString().padStart(4, '0')}` },
        });
      } catch (error) {
        if ((error as { code?: string })?.code !== "P2025") throw error; // ignore tasks deleted concurrently
      }
      currentRank += 30; // Increment by 20 for the next task
    }

    Array.from(new Set(projectIds.map((task) => task.projectId))).forEach((projectId) =>
      void broadcastBoardChange(projectId)
    );

    return res.status(200).json({message:"success"});
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({message:"SOMETHING WENT WRONG"});

  } 
}
}

// Run the main function
export default handler;
