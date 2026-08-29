import prisma from "@/lib/prisma"

const getDraftsController = async(taskId:number, userId:number)=>{
    const toReturn= await prisma.drafts.findMany({
        where:{
            taskId:taskId,
            userId:userId,
            content:{
                not:"<p></p>"
            }
        }

    })
     return toReturn
}

export default getDraftsController