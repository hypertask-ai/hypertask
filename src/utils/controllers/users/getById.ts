import { logger as htLogger } from "#logger";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";


const getUserById= async (userId:number):Promise<any> => {
   
        try {
            const user = await prisma.user.findUnique({
                where: {
                    id:userId 
                },
                include:{
                    UserSetting:true
                }
            })

            return ({
                status:200,
                res:user
            })
        } catch (error) {
            htLogger.info(error);
            
            return ({
                status:500,
                res:[]
            })
        }

};

export default getUserById;