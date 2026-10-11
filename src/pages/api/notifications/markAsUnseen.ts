import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { NotificationType, PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
            if (!session) return res.status(401).json({ message: "Unauthorized" });
            const {notificationId,taskId, seen} = req.query;
            if (!notificationId &&!taskId && !seen) {
                return res.status(400).json({ message: "Notification id and type are required" });
            }
            // const notification = await prisma.notification.findUnique({
            //     where: {
            //         id: parseInt((id as string))
            //     }
            // })
            // if (!notification) {
            //     return res.status(400).json({ message: "Notification is not found" });
            // }
            // const newNotification = await prisma.notification.update({
            //     where: {
            //         id: parseInt((id as string))
            //     },
            //     data: {
            //         ...notification,
            //         status: 'Archive'
            //     }
            // })
            

            // if user wants to mark unread by taskid.
            if (taskId){
                const parsedTaskId = parseInt(taskId as string)
                if (!Number.isInteger(parsedTaskId)) {
                    return res.status(400).json({ message: "Notification id and type are required" });
                }
                // get latest notification from that tsak
                const notification_ = await prisma.notification.findFirst({
                    where:{
                        taskId: parsedTaskId,
                        userId: session.userId,
                        status:"Normal"
                    },
                    orderBy:{
                        createdAt:"desc"
                    }
                })
                if (!notification_) {
                    return res.status(404).json({ message: "Notification not found" });
                }
                const updatedNotification = await prisma.notification.update({
                            where:{
                                id:notification_.id,
                                
                            },
                            data:{
                                seen:!notification_.seen
                            },
                            
                        })
                return res.status(200).json(updatedNotification);

            }
            // if by notification id
            else{
                const parsedNotificationId = parseInt(notificationId as string)
                if (!Number.isInteger(parsedNotificationId)) {
                    return res.status(400).json({ message: "Notification id and type are required" });
                }
                const owned = await prisma.notification.findFirst({
                    where: { id: parsedNotificationId, userId: session.userId },
                    select: { id: true },
                })
                if (!owned) return res.status(404).json({ message: "Notification not found" });
                const updatedNotification = await prisma.notification.update({
                 where:{
                     id: parsedNotificationId,
                 },
                 data:{
                     seen:seen==="1"?false:true
                 },
                 
                })
               
                 return res.status(200).json(updatedNotification);
            }
        } catch (error) {
            console.log(error);
            
            return res.status(500).json({ message: "Internal server error" });
        }
    }
    else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default withTaskWriteFlag(handler, "GET", async () =>
  (await import("@/lib/api/notification-writes/mark-unseen")).GET,
);