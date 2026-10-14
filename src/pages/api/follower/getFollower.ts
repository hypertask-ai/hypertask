
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        try {
            const {taskId} = req.body;
            const task = await prisma.task.findFirst({
              where: {
                id: Number(taskId),
                project: getProjectWhere(session.userId),
              },
              select: { userId: true, agentId: true },
            });
            if (!task) {
              return res.status(404).json({ message: "Task not found" });
            }
                
              const followersRaw = await prisma.follower.findMany({
                  where: { taskId: taskId },
                  select: {
                    id: true,
                    taskId: true,
                    userId: true,
                    agentId: true,
                    mentionById: true,
                    mentionAt: true,
                    user: { select: { id: true, displayName: true, photoURL: true } },
                    agent: { select: { id: true, displayName: true, photoURL: true } },
                  },
                });

              let followers = followersRaw;
              if (task?.agentId) {
                followers = followersRaw.filter((f) => f.agentId !== task.agentId);
              } else if (task?.userId) {
                followers = followersRaw.filter((f) => f.userId !== task.userId);
              }
      

              res.setHeader(
                'Cache-Control',
                'public, s-maxage=100'
              )
            

            return res.status(200).json(followers)
           
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;