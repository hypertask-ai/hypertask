import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import getNotificationStatus from "@/utils/controllers/notifications/getNotificationStatus";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const userId = session.userId;
        try {
            const response = await getNotificationStatus(userId)
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