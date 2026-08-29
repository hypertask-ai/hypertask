import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";
import { invalidateHyperAiCommentOrigin } from "@/lib/ai/hyperAiConfirmation";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const { id } = req.query;
            const comment = await prisma.comment.findUnique({
                where: {
                    id: parseInt(id as string)
                }
            })
            res.status(200).json(comment);
        } catch (error) {
            res.status(500).json({ message: "Internal server error" });
        }
    } if (req.method === "PUT") {
        try {
            // console.log(req.body);
            const { newComment } = req.body;
            await invalidateHyperAiCommentOrigin(newComment.id);
            const comment = await prisma.comment.update({
                where: {
                    id: newComment.id
                },
                data: {
                    text: newComment.text,
                    ...newComment
                }
            })
            res.status(200).json(comment);
        } catch (error) {
            console.log(error);

            res.status(500).json({ message: "Internal server error" });
        }
    }
    else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
