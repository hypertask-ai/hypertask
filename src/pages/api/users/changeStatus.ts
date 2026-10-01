import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import changeNotificationStatus from "@/utils/controllers/notifications/changeNotificationStatus";
import { getSessionUser } from "@/lib/auth/getSessionUser";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const userId = session.userId;
        try {
            const { notification } = req.body;
           
            console.log("========================================",userId , notification)
            const response = await changeNotificationStatus(userId , notification)
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