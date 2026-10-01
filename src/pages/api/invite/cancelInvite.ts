// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  const {projectId, email} = req.body;
 
  try {
    if (!projectId || !email) return res.status(400).json({message:"Missing required information"})
    const parsedProjectId = Number(projectId)
    if (!Number.isInteger(parsedProjectId)) return res.status(400).json({message:"Missing required information"})
    const access = await sessionCanManageProjectInvites(session.userId, parsedProjectId)
    if (access === "missing") return res.status(404).json({message:"Invite not found"})
    if (access !== "ok") return res.status(403).json({message:"Forbidden"})

      const invite = await prisma.invite.findFirst({where:{emails:{has:email}, projectId: parsedProjectId}, 
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
        
      await cancelInvite(invite.id, email, parsedProjectId)
      const deletedInvite = await prisma.invite.deleteMany({
        where:{
          projectId: parsedProjectId, 
          emails:{has:email},
        }})
        console.log("🚀 ~ deletedInvite:", deletedInvite)

      return res.status(200).json({message:"Success!"})
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}


async function sessionCanManageProjectInvites(userId: number, projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { id: true },
  })
  if (!project) return "missing"
  const allowed = await getMemberAndOwner(projectId)
  return Array.isArray(allowed) && allowed.includes(userId) ? "ok" : "forbidden"
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