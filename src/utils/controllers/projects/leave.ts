import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import { IProject } from "@/models/model";
import { stripe } from "@/lib/subscription";

import prisma from "@/lib/prisma";
import getFirst from "./getFirst";


const leaveProject = async (projectId:number, userId:number) => {
        try {
            if (!projectId) {
                return({
                    status:400,
                    json:{ message: "User id is required" }
                })
            }
            
            const project:any = await prisma.project.findUnique({
                where: {
                    id: projectId,
                    
                },
                include:{
                    members:true,
                    owner:true
                }
            })

            if (!project && project?.ownerId===userId) {
                return({status:400, json:{ message:"Project not valid"}})
            }
     
            const member = await prisma.member.findFirst({
                where:{
                    userId,
                    projectId,
                    agentId: null
                }
            })

            const memberAgents = await prisma.member.findMany({
                where:{
                    userId:userId,
                    projectId:projectId,
                    agentId: { not: null }
                }
            })

            for (const agent of memberAgents) {
                await prisma.member.delete({
                    where:{
                        id:agent.id
                    }
                })
            }

            await prisma.member.delete({
                where:{
                    id:member?.id,
                    
                }
            })

            const firstProject = await getFirst(userId, { withTasks: true })

            return({
                status:200,
                json:{message:"Success", firstProject: firstProject.json}
            })
        } catch (error) {
            console.log(error);
            return({
                status:400,
                json:{ message: JSON.stringify(error) }
            })
        }
    
};

export default leaveProject;