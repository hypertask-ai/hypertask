import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const commentsGetCount = async (userId: number) => {
    try {
        const commentCount = await prisma.comment.count({
            where: {
                NOT: { creatorId: userId },
                task: { project: projectContentAccessWhere(userId) },
            },
        });
        return { status: 200, json: commentCount };
    } catch (error) {
        return { status: 500, json: { message: "Internal server error" } };
    }
};

export default commentsGetCount;
