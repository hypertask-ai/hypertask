import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { createFullScreenTaskAndReturn } from "@/lib/api/task-writes/create-fullscreen";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next"
import create from "@/utils/controllers/tasks/create";
import generateRank from "@/utils/generateRank";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const userObj = await loadSessionUserRecord(session.userId);
        try {
            const { title, description, section, userId, ranking, projectId,sectionId, index, fullScreenTask, projectIdentifier, agentId } = req.body;
        
            if (fullScreenTask) {
                const newTask = await createFullScreenTaskAndReturn(projectId, userId,projectIdentifier,title, userObj, agentId)

                if (newTask.error && newTask.status) return res.status(newTask.status).json({ message: newTask.message })
                if (newTask.error) return res.status(406).json({newTask})
                else {
                    void broadcastBoardChange(projectId, { originUserId: userObj?.id });
                    return res.status(200).json({newTask})
                }
            }

            
            if (!title  || !projectId) return res.status(400).json({ message: "Missing Required Information" });


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

export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/task-writes/create")).POST,
);



export { createFullScreenTaskAndReturn } from "@/lib/api/task-writes/create-fullscreen";
