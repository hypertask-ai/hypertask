import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import getAllTeams from "@/utils/controllers/teams/getAll";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const session = verifySession(req.cookies[SESSION_COOKIE])
        if (!session) {
            return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" })
        }

        const response = await getAllTeams(session.id)
        return res.status(response.status).json(response.json)
        
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
