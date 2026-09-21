import prisma from "@/lib/prisma";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";




const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const {payload} = req.body;

        const result = await prisma.project.findUnique({
            where:{
                id:payload.projectId,
                
            },
            include:{
                
            },
            
        })
        
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;