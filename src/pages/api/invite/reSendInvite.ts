import { enqueueOutsideSaveAndProcessSoon } from "@/lib/telemetry/analyticsIntents";
import { enqueueInviteSent } from "@/lib/telemetry/inviteAnalytics";

import type { NextApiRequest, NextApiResponse } from 'next/dist/shared/lib/utils'
import prisma from "@/lib/prisma";
import { createNotification, generateInviteLink, setViewSlug } from './createInviteLink';
import { cancelInvite } from './cancelInvite';
import { getProjectViewInclude } from '@/utils/controllers/projects/getAll';
import { getViewFromProject } from '@/utils/helperFunctions/Views/ViewsHelperFunctions';
import { IViewType } from '@/models/model';
import { sendEmailNotification } from '@/utils/controllers/notifications/sendNotification';
import { getSessionUser } from "@/lib/auth/getSessionUser";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";



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
    
    const {projectId: rawProjectId, email} = req.body;
    const projectId = Number(rawProjectId)
    if (!Number.isInteger(projectId) || !email) return res.status(400).json({message:"Missing required information"})
    const allowed = await getMemberAndOwner(projectId)
    if (!Array.isArray(allowed) || !allowed.includes(user.id)) return res.status(403).json({message:"Forbidden"})
    const userId = user.id

      var invite:any = undefined
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

      if (invite){inviteLink = await generateInviteLink(invite.id, projectId, invite.project.title ?? "", viewSlug, user.id)}
        

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
      if (sent) await enqueueOutsideSaveAndProcessSoon(() => enqueueInviteSent(prisma, invite, "email", invite.userId, user.id));
      return res.status(200).json({message:"Success!"})
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
