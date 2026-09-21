

import prisma from "@/lib/prisma";


import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const {taskId} = req.query;

            if (!taskId) return res.status(400).json({message:"Missing Required Task ID"})
            const user = JSON.parse(req.cookies.nookies_user!)

            // get the estimate if any for that task
            const estimate=  await prisma.estimate.findFirst({
                where:{
                    taskId:parseInt(taskId as string) 
                }
            })
            
            res.status(200).json(estimate);
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;