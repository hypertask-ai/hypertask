import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

import commentsGetCountByTask from "@/utils/controllers/comments/getCountByTask";



const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    if (req.method === "GET") {
        try {
            const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
            if (!session) return res.status(401).json({ message: "Unauthorized" });
            const { taskId } = req.query;
            if (!taskId) return  res.status(405).json({ message: "Missing Required ID" });

            const response = await commentsGetCountByTask(taskId, session.userId)
            res.status(response.status).json(response.json);
        } catch (error) {
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;