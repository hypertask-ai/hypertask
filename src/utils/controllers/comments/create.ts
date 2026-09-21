import { NextApiHandler, NextApiRequest, NextApiResponse } from "next"
import checkReminderAndCreateNotification from "../notifications/creation-service/check-reminder_create-notification";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const { text, creatorId, taskId, ownerId } = req.body;

            if (!text || !creatorId || !taskId || !ownerId) return res.status(400).json({ message: "Bad request" });

            const task = await prisma.task.findUnique({
                where: {
                    id: taskId
                }
            })

            if (!task) return res.status(400).json({ message: "Bad request" });

            const comment = await prisma.comment.create({
                data: {
                    text,
                    creatorId,
                    taskId
                },
            })


            const assignees = await prisma.assignees.findMany({
                where: {
                   
                    taskId,
                    NOT: [
                        { userId: creatorId },
                        { userId: ownerId }
                      ]
                    
                }     
            }
            )

            for (var i = 0; i < assignees.length; i++) {
                console.log(task.id)
                await checkReminderAndCreateNotification(
                    assignees[i].userId,
                    task.projectId,
                    task.id,
                    {
                        commentId: comment.id,
                        userId: assignees[i].userId,
                        taskId:task.id,
                        projectId:task.projectId,
                        fromUserId:creatorId
                    }
                );
            }


            if(creatorId !== task.userId) {
                await checkReminderAndCreateNotification(
                    task.userId,
                    task.projectId,
                    task.id,
                    {
                        commentId: comment.id,
                        userId: task.userId,
                        taskId:task.id,
                        projectId:task.projectId,
                        fromUserId:creatorId
                    }
                );
            }

            res.json(comment)
        } catch (error) {
            console.log({error})
            res.status(500).json({ message: "Internal server error" })
        }
    } else {
        res.status(405).json({ message: "Method not allowed" })
    }
}

export default handler;