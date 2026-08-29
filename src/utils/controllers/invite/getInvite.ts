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
            // console.log(comments);
        } catch (error) {
            console.log(error);

            // res.status(500).json({ message: "Internal server error" });
        }

};

export default getInvite;