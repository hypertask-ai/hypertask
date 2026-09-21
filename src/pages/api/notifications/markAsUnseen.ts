import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { NotificationType, PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
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
                // get latest notification from that tsak
                const notification_ = await prisma.notification.findFirst({
                    where:{
                        taskId:parseInt(taskId as string),
                        status:"Normal"
                    },
                    orderBy:{
                        createdAt:"desc"
                    }
                })
                const updatedNotification = await prisma.notification.update({
                            where:{
                                id:notification_?.id,
                                
                            },
                            data:{
                                seen:!notification_?.seen
                            },
                            
                        })
                return res.status(200).json(updatedNotification);

            }
            // if by notification id
            else{
                const updatedNotification = await prisma.notification.update({
                 where:{
                     id:parseInt(notificationId as string),
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

export default handler;