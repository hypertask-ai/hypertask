

import prisma from "@/lib/prisma";


import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        try {
            const {taskId} = req.query;

            if (!taskId) return res.status(400).json({message:"Missing Required Task ID"})

            const task = await prisma.task.findFirst({
                where: { id: parseInt(taskId as string), project: projectContentAccessWhere(session.userId) },
                select: { id: true },
            });
            if (!task) return res.status(404).json({ message: "Task not found" });

            // get the priority if any for that task
            const priority=  await prisma.priority.findFirst({
                where:{
                    taskId:parseInt(taskId as string) 
                }
            })
            
            res.status(200).json(priority);
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;