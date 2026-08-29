import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import commentsGetCountByTask from "@/utils/controllers/comments/getCountByTask";



const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const { taskId } = req.query;
            if (!taskId) return  res.status(405).json({ message: "Missing Required ID" });

            const response = await commentsGetCountByTask(taskId)
            res.status(response.status).json(response.json);
        } catch (error) {
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;