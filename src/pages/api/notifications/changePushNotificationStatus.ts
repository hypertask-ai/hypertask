import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
            if (!session) return res.status(401).json({ message: "Unauthorized" });
            const { firebaseId, newStatus } = req.body;
            if (!firebaseId ) return res.status(304).json({message:"Missing Required Data"})
            console.log("🚀 ~ file: changePushNotificationStatus.ts:11 ~ consthandler:NextApiHandler= ~ firebaseId:", firebaseId)
            
            const deviceStatus = await prisma.subscribedDevices.updateMany({
                where:{
                    firebaseId:firebaseId,
                    userId: session.userId,
                },
                data:{
                    sendNotifications:newStatus 
                }
            })
            if (deviceStatus.count === 0) {
                return res.status(404).json({ message: "Device not found" });
            }
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