import create from "@/utils/controllers/tasks/create";
import generateRank from "@/utils/generateRank";
import prisma from "@/lib/prisma";

export const createFullScreenTaskAndReturn = async(projectId:number, userId:number, projectIdentifier:number, title:string, currentUser:{id:number}, agentId?:string | null, description?:string)=>{
    try {

        const section = await prisma.section.findFirst({
            where:{
                AND:[
                    {
                        visibility:true,
                    },
                    {
                        deleted:false,
                    }
                ],

                projectId
            },
            orderBy:{
                ranking:"asc"
            }
        })
        console.log("🚀 ~ createFullScreenTaskAndReturn ~ section:", section)
        if (!section) throw "No section"

        const task = await prisma.task.findFirst({
            where:{
                sectionId:section.id,
                projectId
            },
            orderBy:{
                ranking:"asc"
            },

        })
        const ranking = generateRank(undefined, task?task.ranking:undefined)
        console.log("🚀 ~ createFullScreenTaskAndReturn ~ task:", task)
        const response = await create({
            title,
            description:"",
            section:section.section_title,
            userId,
            ranking:ranking!,
            projectId,
            sectionId:section.id,
            currentUser,
            agentId,
        })
        if (response.status !== 200) {
            return {message:(response.json as {message:string}).message, error:true, status:response.status}
        }
        const createdTask = response.json as {id:number}
        const newTask = await prisma.task.findUnique({
            where:{id:createdTask.id},
            include:{project:true}
        })
        const description_ = await prisma.description.findUnique({where:{taskId:createdTask.id}})
        if (!newTask) throw "Task was not created"

        return {message:"Created a new task", newTask:{...newTask, description_}, error:false}

    } catch (error) {
        console.log("🚀 ~ createFullScreenTaskAndReturn ~ error:", error)
        return {message:"The project must have at least one section before creating a task", error:true}
    }


}
