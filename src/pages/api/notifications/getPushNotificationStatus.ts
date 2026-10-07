import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
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
            const { firebaseId } = req.query;

            if (!firebaseId) return res.status(304).json({message:"Missing UserId"})
            
            const deviceStatus = await prisma.subscribedDevices.findFirst({
                where:{
                    firebaseId:firebaseId as string,
                    userId
                }
            })

            return res.status(200).json(deviceStatus);
        } catch (error) {
            console.log({error})
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default withTaskWriteFlag(handler, "GET", async () =>
  (await import("@/lib/api/notification-writes/push-status-read")).GET,
);