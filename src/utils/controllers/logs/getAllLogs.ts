import { logger as htLogger } from "#logger";


import prisma from "@/lib/prisma";


const getAllLogs = async () => {
        try {
            const allLogs =await prisma.logs.findMany({orderBy:{createdAt:"desc"}})
            
            return ({
                status:200,
                json:allLogs
            })
            // res.status(200).json(comments);
        } catch (error) {
            htLogger.info(error);
            return ({
                status:500,
                json:[],
                error:error
            })
            // res.status(500).json({ message: "Internal server error" });
        }

};

export default getAllLogs;