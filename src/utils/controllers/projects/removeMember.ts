
import { stripe } from "@/lib/subscription";

import prisma from "@/lib/prisma";
import isProjectAdmin from "./isProjectAdmin";


const membersRemove = async (userId:number, projectId:number, actingUserId:number) => {
        try {
            if (!userId || !projectId || !actingUserId) {
                return({status:400,  json:{message:"Missing required information"}})
            }
            if (!(await isProjectAdmin(actingUserId, projectId))) {
                return({status:401, json:{message:"Only Board owner or admin can remove members"}})
            }
            const user = await prisma.user.findUnique({
                where: {
                    id: userId
                }
            })
            if (!user) {
                return({status:400, json:{message:"User not found"}})
            }

            const project = await prisma.project.findUnique({
                where: {
                    id: projectId
                }
            })
            if (!project) {
                return({status:400, json:{ message:"Project not valid"}})
            }

            if(project.ownerId === userId) {
                return({status:400, json:{ message:"Cannot remove project owner"}})
            }
            const member = await prisma.member.findFirst({
                where:{
                    userId:userId,
                    projectId:projectId,
                    agentId: null,
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

            if (member) {
                await prisma.member.delete({
                    where:{
                        id:member.id,
                    }
                })
            }

            return({status:200, json:["Success"]})
        } catch (error) {
            console.log(error);
            return({status:400, json:{message:JSON.stringify(error)}})
        }

};

export default membersRemove;
