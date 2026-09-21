import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import notificationGetByTask from "@/utils/controllers/notifications/getByTask";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

// HTPR-4465: same defect as /api/notifications/getByTask, which this route calls.
// `userId` came from the request body, so any logged-in user could mark another
// user's notifications seen (silencing their digest emails) and push an
// arbitrary id into comment.seen. Identity comes from the session now; the body
// value is ignored. The only caller already sent its own id.
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const session = await getSessionUser(
                new Headers(req.headers as Record<string, string>),
            );
            if (!session) return res.status(401).json({ message: "Unauthorized" });

            const { commentIds, taskId } = req.body;
            const userId = session.userId;

            if (!commentIds) {
                return res.status(400).json({ message: "Comment ids are required" });
            }

            await notificationGetByTask(userId, taskId);

            // One UPDATE for the whole task, and only for comments this user has
            // not seen yet — the previous per-comment update fan-out starved the
            // Prisma pool (limit 5) on tasks with many comments. See HTPR-4033.
            await prisma.comment.updateMany({
                where: {
                    id: { in: commentIds },
                    NOT: { seen: { has: userId } },
                },
                data: {
                    seen: { push: userId },
                },
            });

            return res.status(200).json({ message: "Success" });
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
