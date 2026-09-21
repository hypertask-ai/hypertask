import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import getAllProjectsController from "@/utils/controllers/projects/getAll";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";



const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const session = verifySession(req.cookies[SESSION_COOKIE])
        if (!session) {
            return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" })
        }
        
        console.time("getAllProjects API Fetch time")
        const response = await getAllProjectsController(
            session.id,
            session.id,
            req.body?.projectId
        )
        console.timeEnd("getAllProjects API Fetch time")
        return res.status(response.status).json(response.json)
        
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
