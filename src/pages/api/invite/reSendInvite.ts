// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next/dist/shared/lib/utils'
import prisma from "@/lib/prisma";
import { createNotification, generateInviteLink, setViewSlug } from './createInviteLink';
import { cancelInvite } from './cancelInvite';
import { getProjectViewInclude } from '@/utils/controllers/projects/getAll';
import { getViewFromProject } from '@/utils/helperFunctions/Views/ViewsHelperFunctions';
import { IViewType } from '@/models/model';
import { sendEmailNotification } from '@/utils/controllers/notifications/sendNotification';



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    const {projectId, email, userId} = req.body;
    const user = JSON.parse(req.cookies.nookies_user!)
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
      if (invite){inviteLink = generateInviteLink(invite.id, projectId, invite.project.name, viewSlug)} 
        

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
    
        inviteLink = generateInviteLink(invite.id, projectId, invite.project.name, viewSlug)
      }

      await cancelInvite(invite.id, email, projectId)
      // ============== create a new notification and another email
      await createNotification(email, inviteLink, user.id, invite.id, projectId)
      await sendEmailNotification("Invite", {
        sender: user.displayName,
        recipient: email,
        title: invite.project.name,
        link: inviteLink,
      })
      
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
