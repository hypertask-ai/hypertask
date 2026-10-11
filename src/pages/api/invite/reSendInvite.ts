import { recordActivationOccurrence } from "@/lib/telemetry/activationOccurrences";
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next/dist/shared/lib/utils'
import prisma from "@/lib/prisma";
import { createNotification, generateInviteLink, setViewSlug } from './createInviteLink';
import { cancelInvite } from './cancelInvite';
import { getProjectViewInclude } from '@/utils/controllers/projects/getAll';
import { getViewFromProject } from '@/utils/helperFunctions/Views/ViewsHelperFunctions';
import { IViewType } from '@/models/model';
import { sendEmailNotification } from '@/utils/controllers/notifications/sendNotification';
import { getSessionUser } from "@/lib/auth/getSessionUser";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, displayName: true, email: true, userPicture: { select: { nameSet: true, displayName: true } } },
    });
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const {projectId, email, userId} = req.body;
    if (!projectId || !email || !userId) return res.status(400).json({message:"Missing required information"})

      var invite:any = undefined
      // =============== first find the invite
      invite = await prisma.invite.findFirst({
        where:{
          emails:{
            has:email
          },
          projectId
        },
        include:{
          project:{
            include:{
              project_view:getProjectViewInclude({currentUserId: userId}),
            }
          
        }}
      })
      let inviteLink:string;
      let viewSlug: string | undefined;
      let activeView: IViewType | undefined;
      activeView = getViewFromProject(invite.project)
      viewSlug = setViewSlug(activeView)

      // ========= invite was found, create the link again, and resend the email
      if (invite){inviteLink = await generateInviteLink(invite.id, projectId, invite.project.title ?? "", viewSlug, user.id)}
        

      // ========= invite wasn't found so create a new one and set the invite link's value
      else{
        invite = await prisma.invite.create({
          data:{
              userId:user.id,
              projectId:projectId,
              key:"SOME-KEY",
              uses:1,
              emails:email,
              expired:false

          },
          include:{
            project:{
              include:{
                project_view:getProjectViewInclude({currentUserId: userId}),
              }
          
        }}
          })

        activeView = getViewFromProject(invite.project)
        viewSlug = setViewSlug(activeView)
    
        inviteLink = await generateInviteLink(invite.id, projectId, invite.project.title ?? "", viewSlug, user.id)
      }

      await cancelInvite(invite.id, email, projectId)
      // ============== create a new notification and another email
      await createNotification(email, inviteLink, user.id, invite.id, projectId)
      const sent = await sendEmailNotification("Invite", {
        sender: user.displayName ?? "",
        senderUserId: user.id,
        senderEmail: user.email,
        senderName: user.userPicture?.nameSet
          ? user.userPicture.displayName ?? undefined
          : undefined,
        recipient: email,
        title: invite.project.title ?? "",
        link: inviteLink,
      })
      if (sent) recordActivationOccurrence(user.id, "teammate_invited", invite.id, { method: "email" });
      
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
