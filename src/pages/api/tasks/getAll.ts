import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import tasksGetAll from "@/utils/controllers/tasks/getAll";
import { loadCurrentUser } from "@/lib/auth/currentUser";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const session = await loadCurrentUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        try {
            const { projectId } = req.body;

            if (!projectId) {
                return res.status(200).json("Missing Required Data");
            }
            const response = await tasksGetAll(projectId, session.userId )
            // const tasks = await prisma.task.findMany({
            //     where: {
            //         projectId: parseInt(projectId as string),
            //         status: 'Normal',
            //     },
            //     select: {
            //         id: true,
            //         title: true,
            //         uniqueIndex: true,
            //         ranking: true,
            //         userId: true,
            //         projectId: true,
            //         section: true,
            //         sectionId:true,
            //         assignees: {
            //             select: {
            //                 user: true
            //             }
            //         },
            //         comments: {
            //             select: {
            //                 id: true,
            //                 notifications: {
            //                     select: { id: true },
            //                     where: {
            //                         seen: false,
            //                         userId: parseInt(userId as string),
            //                     }
            //                 }
            //             }
            //         }
            //     },
            //     orderBy: {
            //         ranking: 'asc'
            //     }
            // })
            return res.status(response.status).json(response.json);
        } catch (error) {
            console.log(error);
            return res.status(200).json([]);
        }
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;