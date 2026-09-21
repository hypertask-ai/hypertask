import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const { userId } = req.query;
            const comments = await prisma.comment.findMany({
                include: {
                    task: {
                        include: {
                            assignees: {
                                where: {
                                    userId: parseInt(userId as string)
                                }
                            },
                            project: true
                        }
                    }
                },
                where: {
                    NOT: {
                        creatorId: parseInt(userId as string)
                    }
                }
            })
            res.status(200).json(comments);
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;