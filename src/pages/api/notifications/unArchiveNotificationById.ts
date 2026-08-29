// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { broadcastInboxChange, socketIdFromHeader } from "@/lib/realtime/server";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    // Derive the caller from the auth cookie: /api is outside middleware, and
    // Notification.id is a plain autoincrement, so without this anyone could
    // unarchive another user's notifications by guessing an id.
    let user: { id?: number } | null = null;
    try {
        user = JSON.parse(req.cookies.nookies_user!);
    } catch {
        user = null;
    }
    if (!user?.id) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    const {notificationId}= req.body;
    if (!notificationId){
        return res.status(400).json({message:"Missing Required Information"})
    }

    // Scope the write to the caller's own notification; unknown id or someone
    // else's returns 0 rows -> 404, never touches another user's data.
    const { count } = await prisma.notification.updateMany({
        where:{ id:notificationId, userId:user.id },
        data:{
            status:"Normal",
            archivedAt:null
        }
    })
    if (count === 0){
        return res.status(404).json({message:"Notification not found"})
    }
    const updatedNotification = await prisma.notification.findUniqueOrThrow({
        where:{id:notificationId}
    })

    // ============== DELETE all OTHER notifications of that type. so no duplicate types
    await prisma.notification.updateMany({
        where:{
            id:{not:updatedNotification.id},
            type:updatedNotification.type,
            userId:updatedNotification.userId,
            taskId:updatedNotification.taskId,
        },
        data:{
            status:"Deleted"
        }
    })
    // Live-sync the unarchive to this user's other tabs (e.g. the Inbox Archive
    // view). Fire-and-forget; exclude the acting tab so it doesn't double-refetch.
    const excludeSocketId = socketIdFromHeader(req.headers["x-socket-id"]);
    void broadcastInboxChange(
        updatedNotification.userId,
        { originUserId: updatedNotification.userId },
        excludeSocketId
    );

    return res.status(200).json(updatedNotification)
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
