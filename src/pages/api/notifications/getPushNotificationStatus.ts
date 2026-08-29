import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const { firebaseId } = req.query;
            const user = JSON.parse(req.cookies.nookies_user!);

            if (!firebaseId || !user) return res.status(304).json({message:"Missing UserId"})
            
            const deviceStatus = await prisma.subscribedDevices.findFirst({
                where:{
                    firebaseId:firebaseId as string,
                    userId:user.id
                }
            })

            return res.status(200).json(deviceStatus);
        } catch (error) {
            console.log({error})
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;