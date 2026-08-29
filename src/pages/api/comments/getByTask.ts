import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import commentsGetByTask from "@/utils/controllers/comments/getByTask";

import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const { taskId } = req.query;
            const user = JSON.parse(req.cookies.nookies_user!)

            if (!taskId) {
                return res.status(400).json({ message: "User id is required" });
            }
            // const comments = await prisma.comment.findMany({
            //     where: {
            //         taskId: parseInt(taskId as string)
            //     },
            //     orderBy: {
            //         createdAt: 'asc'
            //     }
            // })
            const response = await commentsGetByTask(user,taskId)
            res.status(response.status).json(response.json);
            // console.log(comments);
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;