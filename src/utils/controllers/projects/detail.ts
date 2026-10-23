import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const publicUserSelect = { id: true, displayName: true, photoURL: true } as const;


const projectDetail = async (projectId:number, userId:number, agentId?:string, teamScope?: AgentTokenTeamScope | null) => {
        try {
            if (!projectId) {
                return({
                    status:400,
                    json:{ message: "Project id is required" }
                })
            }
            let project = await prisma.project.findFirst({
                relationLoadStrategy: "join",
                where: {
                    id: projectId,
                    status:"Normal",
                    ...projectContentAccessWhere(userId, agentId, teamScope)
                },
                include: {
                    tasks: {
                        include: {
                            assignees: {
                                include: {
                                    user: { select: publicUserSelect }
                                }
                            },

                        },
                        where: {
                            status: 'Normal'
                        },
                    },
                    section:{
                        where:{
                            deleted:false,
                            visibility:true
                        },
                        orderBy:{
                            ranking:"asc"
                        }
                    },
                    owner: { select: publicUserSelect },
                    ai_custom_instructions:true

                }
            })
            
         
            if (!project) {
                return({
                    status:400,
                    json:{ message: "Project not found" }
                })
            }
            
            recordAgentBoardScopeMiss(project.id, "read");
            return({
                status:200,
                json:project
            })
        } catch (error) {
            console.log(error);
            return({
                status:400,
                json:{ message: JSON.stringify(error) }
            })
        }

};

export default projectDetail;