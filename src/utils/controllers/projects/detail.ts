import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";


const projectDetail = async (projectId:number, userId:number, agentId?:string) => {
        try {
            if (!projectId) {
                return({
                    status:400,
                    json:{ message: "Project id is required" }
                })
                // return res.status(400).json({ message: "Project id is required" });
            }
            let project = await prisma.project.findFirst({
                relationLoadStrategy: "join",
                where: {
                    id: projectId,
                    status:"Normal",
                    ...projectContentAccessWhere(userId, agentId)
                },
                include: {
                    tasks: {
                        include: {
                            assignees: {
                                include: {
                                    user: true
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
                    owner: true,
                    ai_custom_instructions:true

                }
            })
            
         
            if (!project) {
                return({
                    status:400,
                    json:{ message: "Project not found" }
                })
            }
            
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