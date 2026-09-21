import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import getNotificationStatus from "@/utils/controllers/notifications/getNotificationStatus";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const userid:any = JSON.parse(req.cookies?.nookies_user!) 
    if (req.method === "GET") {
        try {
            const response = await getNotificationStatus(userid?.id)
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