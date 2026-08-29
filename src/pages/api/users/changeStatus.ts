import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import changeNotificationStatus from "@/utils/controllers/notifications/changeNotificationStatus";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const userid:any = JSON.parse(req.cookies?.nookies_user!) 
    if (req.method === "POST") {
        try {
            const { notification } = req.body;
           
            console.log("========================================",userid?.id , notification)
            const response = await changeNotificationStatus(userid?.id , notification)
            return res.status(200).json(response)
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;