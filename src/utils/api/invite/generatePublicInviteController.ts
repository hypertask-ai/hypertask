import prisma from "@/lib/prisma"
import { generateInviteLink, setViewSlug } from "@/pages/api/invite/createInviteLink"
import { getProjectViewInclude } from "@/utils/controllers/projects/getAll"
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions"

export const getInviteFromProjectId = async(projectId:number, userId: number)=>{
        const project = await prisma.project.findUnique({
            where:{
                id:projectId
            },
            include:{
                project_view:getProjectViewInclude({currentUserId: userId}),
            }
        })
        if (!project) return 
       // ============ check if the invite link already exists.
       const invite = await prisma.invite.findFirst({
        where:{
            projectId,
            uses:{
                lte:0
            },
            emails:undefined,
            key:"public",
            expired:false
        },
        include:{project:{select:{name:true}}},
    })
    console.log("🚀 ~ invite:", invite)
    

    // ======================== let's check for the active view if any
    const activeView = getViewFromProject(project)
    let viewSlug: string | undefined;
    viewSlug = setViewSlug(activeView)
    if (invite) return {inviteLink:generateInviteLink(invite.id, projectId, invite.project.name, viewSlug), amountUsed:(invite.uses*-1)-1}

    // ============ create a new invite link
    const newInvite = await prisma.invite.create({
        data:{
            key:"public",
            projectId,
            uses:-1,
            expired:false,
            userId:project?.ownerId
        },
        include:{project:{select:{name:true}}},
    })
    return {inviteLink:generateInviteLink(newInvite.id, projectId, newInvite.project.name, viewSlug), amountUsed:(newInvite.uses*-1)-1}

}