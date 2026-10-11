import { getSessionUser } from "@/lib/auth/getSessionUser";
import commentsGetCount from "@/utils/controllers/comments/getCount";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    if (req.method === "GET") {
        try {
            const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
            if (!session) return res.status(401).json({ message: "Unauthorized" });

            const response = await commentsGetCount(session.userId);
            return res.status(response.status).json(response.json);
        } catch (error) {
            return res.status(500).json({ message: "Internal server error" });
        }
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
