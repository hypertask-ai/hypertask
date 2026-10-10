// Import PrismaClient from the generated Prisma client
import fetchUrls from '@/utils/controllers/urls/fetchUrls';
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_7050_CTRL_O_LINKS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';


// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
            if (!session) return res.status(401).json({ message: "Unauthorized" });
            const { taskId, commentId } = req.query;
            if (!taskId) {
                return res.status(400).json({ message: "User id is required" });
            }
            const task = await prisma.task.findFirst({
                where: { id: parseInt(taskId as string), project: projectContentAccessWhere(session.userId) },
                select: { id: true },
            });
            if (!task) return res.status(404).json({ message: "Task not found" });
            const includeSavedSources = await isFeatureEnabled(HTPR_7050_CTRL_O_LINKS_FLAG, session.userId);
            const response = await fetchUrls(taskId, commentId as string, includeSavedSources);
         
            return res.status(response.status).json(response.json);
            // console.log(comments);
        } catch (error) {
            console.log(error);
            return res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
}

// Run the main function
export default handler;


