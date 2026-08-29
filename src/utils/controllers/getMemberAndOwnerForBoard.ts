import prisma from "@/lib/prisma"

const getMemberAndOwner = async(projectId:number):Promise<any>=>{
    try {
        const project = await prisma.project.findUnique({
            where:{id:projectId},
            include:{
                owner:true,
                members:{
                    where: { agentId: null },
                    include:{
                        user:true
                    }
                }
            }
        })
        if (!project) throw "Project doesnt exist"
        const memberIds = project.members.flatMap(x=>x.userId)
        const allusers = [project?.owner.id, ...memberIds]
        return allusers
    } catch (error) {
        return "something went wrong"
    }
}

export default getMemberAndOwner;