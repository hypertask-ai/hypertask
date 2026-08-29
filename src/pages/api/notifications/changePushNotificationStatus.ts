import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const { firebaseId, newStatus } = req.body;
            if (!firebaseId ) return res.status(304).json({message:"Missing Required Data"})
            console.log("🚀 ~ file: changePushNotificationStatus.ts:11 ~ consthandler:NextApiHandler= ~ firebaseId:", firebaseId)
            
            const deviceStatus = await prisma.subscribedDevices.updateMany({
                where:{
                    firebaseId:firebaseId 
                },
                data:{
                    sendNotifications:newStatus 
                }
            })
            // console.log("🚀 ~ file: changePushNotificationStatus.ts:20 ~ consthandler:NextApiHandler= ~ deviceStatus:", deviceStatus)

            return res.status(200).json({message:"success"});
        } catch (error) {
            console.log({error})
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;