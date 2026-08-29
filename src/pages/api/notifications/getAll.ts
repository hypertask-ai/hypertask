import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import notificationGetAll from "@/utils/controllers/notifications/getAll";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            // HTPR-4772: ignore the query userId and use the signed session.
            const session = await getSessionUser(
                new Headers(req.headers as Record<string, string>)
            );
            if (!session) return res.status(401).json({ message: "Unauthorized" });
            
            
            const response = await notificationGetAll(String(session.userId))
            res.status(response.status).json(response.json);
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
