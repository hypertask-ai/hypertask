import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import tasksGetAll from "@/utils/controllers/tasks/getAll";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const { projectId, userId } = req.body;

            if (!projectId || !userId) {
                return res.status(200).json("Missing Required Data");
            }
            const response = await tasksGetAll(projectId, userId )
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