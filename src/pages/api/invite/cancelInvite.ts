// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const {projectId, email} = req.body;
 
  try {
    if (!projectId || !email) return res.status(400).json({message:"Missing required information"})

      const invite = await prisma.invite.findFirst({where:{emails:{has:email}, projectId}, 
        include:{
          Notification_Invite:{
            include:{
              notification:true
            },
            orderBy:{createdAt:"desc"},
            take:1
          }
        }})
      if (!invite) return res.status(404).json({message:"Invite not found"})
        
      await cancelInvite(invite.id, email, projectId)
      const deletedInvite = await prisma.invite.deleteMany({
        where:{
          projectId, 
          emails:{has:email},
        }})
        console.log("🚀 ~ deletedInvite:", deletedInvite)

      return res.status(200).json({message:"Success!"})
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}


export const cancelInvite = async (inviteId:string, email:string, projectId:number)=>{
  const notification_invite_ = await prisma.notification_Invite.findFirst({
    where:{
      inviteId:inviteId
    },
    include:{notification:true}
  })
  console.log("🚀 ~ notification_invite:", notification_invite_)
  try {
    const deletedNotification = await prisma.notification.delete({
      where:{id:notification_invite_?.notificationId}
    })
    console.log("🚀 ~ deletedNotification:", deletedNotification)
    const deletedNotificationInvite = await prisma.notification_Invite.deleteMany({
      where:{
        inviteId:inviteId
      },
    })
    console.log("🚀 ~ deletedNotificationInvite:", deletedNotificationInvite)


  } catch (error) {
    console.log("🚀 ~ error:", error)
    
  }



}