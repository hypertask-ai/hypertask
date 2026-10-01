
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { userCanAccessTaskContent } from "@/utils/controllers/tasks/assertTaskAccess";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const { id } = req.body;
        try {
            const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
            if (!session) return res.status(401).json({ message: "Unauthorized" });
            if (!id) return res.status(400).json({ message: "Missing required information" });

            const follower = await prisma.follower.findUnique({ where: { id } });
            if (!follower) return res.status(404).json({ message: "Follower not found" });
            const ownsRow = follower.userId === session.userId;
            const canAccessTask = await userCanAccessTaskContent(session.userId, follower.taskId);
            if (!ownsRow && !canAccessTask) {
                return res.status(403).json({ message: "Forbidden" });
            }

            const deletedRecord = await prisma.follower.delete({
              where: {
                id,
              },
            });
        
            res.json({ message: 'Record deleted', deletedRecord });
          } catch (error) {
            res.status(500).json({ error: 'Error deleting record' });
          }
        
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;