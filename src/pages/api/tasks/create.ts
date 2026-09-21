import { NextApiHandler, NextApiRequest, NextApiResponse } from "next"
import create from "@/utils/controllers/tasks/create";
import generateRank from "@/utils/generateRank";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const { title, description, section, userId, ranking, projectId,sectionId, index, fullScreenTask, projectIdentifier, agentId } = req.body;
            const userObj:any = JSON.parse(req.cookies?.nookies_user!) 
        
            if (fullScreenTask) {
                const newTask = await createFullScreenTaskAndReturn(projectId, userId,projectIdentifier,title, userObj, agentId)

                if (newTask.error && newTask.status) return res.status(newTask.status).json({ message: newTask.message })
                if (newTask.error) return res.status(406).json({newTask})
                else {
                    void broadcastBoardChange(projectId, { originUserId: userObj?.id });
                    return res.status(200).json({newTask})
                }
            }

            
            if (!title  || !userObj || !projectId) return res.status(400).json({ message: "Missing Required Information" });


            // if ranking and section are missing, find them and send them, too lazy to adjust frontend, but please feel free to optimize it later
            if (ranking && section ){
                const response = await create({title, description, section, userId, ranking, projectId,sectionId,index,currentUser:userObj,agentId })

                if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
                return res.status(response.status).json(response.json)
            }

            // ======================== HTC GLOBAL
            else {
                const task = await prisma.task.findFirst({
                    where:{
                        sectionId:sectionId
                    },
                    orderBy:{
                        ranking:"desc"
                    },
                })
                if (task){
                    
                    const ranking = generateRank(task.ranking, undefined)
                    if (ranking){

                        const response = await create(
                            {
                                title, 
                                description:"", 
                                section:task.section, 
                                userId:userObj.id, ranking, projectId,sectionId,currentUser:userObj,agentId
                            })
                        
                        if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
                        return res.status(response.status).json(response.json)
                    }
                }
                else{
                    const section = await prisma.section.findFirst({
                        where:{
                            id:sectionId,
                            deleted:false
                        }
                    })
                    if (section){
                        // ================ call helper function
                        const response = await create(
                            {
                                title, 
                                description:"", 
                                section:section.section_title, 
                                userId:userObj.id, ranking, projectId,sectionId,currentUser:userObj,agentId
                            })

                        if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
                        return res.status(response.status).json(response.json)
                    }

                }
                
            }
           
        } catch (error) {
            return res.status(500).json({ message: "Internal server error" })
        }
    } else {
        res.status(405).json({ message: "Method not allowed" })
    }
}

export default handler;



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
