import { logger as htLogger } from "#logger";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const getNotificationStatus = async (userid:any) => {
    
        try {
            
            const result = await prisma.userSetting.findMany({
                
                where: {
                    userId: userid,
                    
                }
            })
            return ({
                status:200,
                res:result
            })
           
            // res.status(200).json(comments);
        } catch (error) {
            htLogger.info(error);
            return ({
                status:500,
                json:{ message: "Internal server error" }
            })
        }

};

export default getNotificationStatus;