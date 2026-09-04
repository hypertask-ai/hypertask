import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import getFirst from "@/utils/controllers/projects/getFirst";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        const session = verifySession(req.cookies[SESSION_COOKIE])
        if (!session) {
            return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" })
        }

        try {
            const response  = await getFirst(session.id)
            return res.status(response.status).json(response.json)

        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;