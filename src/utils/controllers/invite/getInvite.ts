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
        } catch (error) {
            console.log(error);
        }

};

export default getInvite;