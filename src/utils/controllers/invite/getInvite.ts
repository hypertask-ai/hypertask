import { logger as htLogger } from "#logger";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const getInvite= async (inviteId:string ) => {

        try {
            
            const invitedProject = await prisma.invite.findFirst({
                where:{
                    id:inviteId
                },
                include:{
                    project:true
                }
                
            })
            return({
                    status:200,
                    json:invitedProject
                })
            // res.status(200).json(comments);
            // debug.log(comments);
        } catch (error) {
            htLogger.info(error);

            // res.status(500).json({ message: "Internal server error" });
        }

};

export default getInvite;