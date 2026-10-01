
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
            // const response = await addFollower(userId, title )
            // const followers = await prisma.follower.findMany({
                
            //   });
              const followersRaw = await prisma.follower.findMany({
                  where: { taskId: taskId },
                  select: {
                    id: true,
                    taskId: true,
                    userId: true,
                    agentId: true,
                    mentionById: true,
                    mentionAt: true,
                    // The follower list renders as an avatar plus a name (AssigneeCard in
                    // MainPageComponents/index.tsx reads photoURL and displayName, nothing
                    // else), so that is all this returns. It used to send whole User rows,
                    // email included, which made an unauthenticated request keyed on an
                    // autoincrement task id an enumerable address book (HTPR-3708).
                    user: { select: { id: true, displayName: true, photoURL: true } },
                    agent: { select: { id: true, displayName: true, photoURL: true } },
                  },
                });

              // Filter out agent if task was created by agent, otherwise filter out user if created by user
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