import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const handler = async (projectId:number) => {
    
    try {
        
        if (!projectId) {
            return ({ message: "Project id is required" });
        }
        let project = await prisma.project.findFirst({
            where: {
                id: projectId,
                status:"Normal"
            },
            include: {
                tasks: {
                    include: {
                        assignees: {
                            include: {
                                user: true
                            }
                        },
                        comments:true,

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
            return ({ message: "Project not found" });
        }
        console.log(project)
        return(project);
    } catch (error) {
        console.log(error);
        return ({ message: JSON.stringify(error) });
    }
  
};

export default handler;