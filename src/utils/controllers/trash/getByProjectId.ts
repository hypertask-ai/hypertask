import prisma from "@/lib/prisma";
import { parsePositiveInt } from "@/lib/parsePositiveInt";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const getTrashByProjectId = async ({ projectId, userId }: { projectId: number; userId: number }) => {
    if (!parsePositiveInt(projectId) || !parsePositiveInt(userId)) return null;

    return prisma.project.findFirst({
        where: {
            id: projectId,
            status: { not: "Deleted" },
            ...projectContentAccessWhere(userId),
        },
        include: {
            tasks: {
                where: {
                    status: "Deleted"
                },
                include: {
                    priority: true,
                    estimate: true,
                    user: true
                },
                orderBy: {
                    deletedAt: "desc",
                }
            }
        },
    });
};

export default getTrashByProjectId;
