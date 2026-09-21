import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const {id} = req.query;
            if (!id) {
                return res.status(400).json({ message: "Notification id is required" });
            }
            const notification = await prisma.notification.findUnique({
                where: {
                    id: parseInt((id as string))
                }
            })
            console.log("🚀 ~ file: markAsDone.ts:18 ~ consthandler:NextApiHandler= ~ notification:", notification)
            if (!notification) {
                return res.status(400).json({ message: "Notification is not found" });
            }
            const newNotification = await prisma.notification.update({
                where: {
                    id: parseInt((id as string))
                },
                data: {
                    ...notification,
                    status: 'Archive'
                }
            })
            res.status(200).json(newNotification);
        } catch (error) {
            console.log(error);
            
            res.status(500).json({ message: "Internal server error" });
        }
    }
    else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;