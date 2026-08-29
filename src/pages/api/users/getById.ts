import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import getAllUsers from "@/utils/controllers/users/getAll";


import prisma from "@/lib/prisma";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        const session = verifySession(req.cookies[SESSION_COOKIE])
        if (!session) {
            return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" })
        }

        const raw = req.query.userId;
        const id = parseInt(String(Array.isArray(raw) ? raw[0] : raw), 10);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ message: "Invalid or missing userId" });
        }
        try {
            const user = await prisma.user.findUnique({
                where: {
                    id,
                },
                include:{
                    UserSetting:true
                }
            })
            return res.status(200).json(user)
        } catch (error) {
            console.log(error);
            
            return res.status(500).json(null)
        }
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
