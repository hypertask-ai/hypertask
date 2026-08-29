import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const getFirst = async (projectName:string) => {
        try {
            if (!projectName) {
                return({
                    status:400,
                    json:{ message: "User id is required" }
                })
            }
            const currentProject = await prisma.project.findFirst({
                where:{
                    name:projectName,
                    status:"Normal"
                },
                include:{
                    owner:true,
                    members:true,
                    ai_custom_instructions:true

                }
            })
            return({
                status:200,
                json:currentProject
            })
        } catch (error) {
            console.log(error);
            return({
                status:400,
                json:{ message: JSON.stringify(error) }
            })
        }
    
};

export default getFirst;