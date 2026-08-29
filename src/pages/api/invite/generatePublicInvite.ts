// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { generateInviteLink, setViewSlug } from './createInviteLink';
import { getInviteFromProjectId } from '@/utils/api/invite/generatePublicInviteController';
import { getProjectViewInclude } from '@/utils/controllers/projects/getAll';
import { getViewFromProject } from '@/utils/helperFunctions/Views/ViewsHelperFunctions';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import getMemberAndOwner from '@/utils/controllers/getMemberAndOwnerForBoard';



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    if (req.method==="GET"){
        const session = await getSessionUser(new Headers(req.headers as Record<string, string>))
        if (!session) return res.status(401).json({message:"Unauthorized"})

        const {projectId:projectIdFromParam} = req.query
        const projectId = parseInt(projectIdFromParam as string)
        const project = await prisma.project.findUnique({
            where:{
                id:projectId
            }
        })
        if (!projectId || !project) return res.status(400).json({message:"Missing required information"})
        const allowed = await getMemberAndOwner(projectId)
        if (!Array.isArray(allowed) || !allowed.includes(session.userId)) return res.status(403).json({message:"Forbidden"})
        //! Fetching project again in getInviteFromProjectId().
        const response = await getInviteFromProjectId(projectId, session.userId)
        if (!response) throw "Error"
        else return res.status(200).json(response)
    }
    else if (req.method==="POST"){
        const session = await getSessionUser(new Headers(req.headers as Record<string, string>))
        if (!session) return res.status(401).json({message:"Unauthorized"})

        const {projectId} = req.body
        const project = await prisma.project.findUnique({
            where:{
                id:projectId
            },
            include:{
                project_view:getProjectViewInclude({currentUserId: session.userId}),
            }
        })
        if (!projectId || !project) return res.status(400).json({message:"Missing required information"})
        const allowed = await getMemberAndOwner(projectId)
        if (!Array.isArray(allowed) || !allowed.includes(session.userId)) return res.status(403).json({message:"Forbidden"})
        const oldInvite = await prisma.invite.findFirst({
            where:{
                projectId,
                
                emails:undefined,
                key:"public",
                expired:false
            }
        })
        await prisma.invite.update({
            where:{
                id:oldInvite?.id
            },
            data:{
                uses:0,
                expired:true,
                expiresAt:new Date()
            }
        })
        const newInvite = await prisma.invite.create({
            data:{
                projectId,
                uses:-1,
                expired:false,
                userId:project.ownerId,
                key:"public"
            },
            include:{project:{select:{name:true}}},
        })
        const activeView = getViewFromProject(project)
        let viewSlug: string | undefined;
        viewSlug = setViewSlug(activeView)
        return res.status(200).json({inviteLink:generateInviteLink(newInvite.id, projectId, newInvite.project.name, viewSlug), amountUsed:(newInvite.uses*-1)-1})
    }

    return res.status(200).json({})
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
