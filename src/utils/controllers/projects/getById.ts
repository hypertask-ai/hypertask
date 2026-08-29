import prisma from "@/lib/prisma";

const getProjectById = async (projectId: number, userId: number) => {
    try {
        if (!projectId || !userId) return null;
        let project;
        project = await prisma.project.findFirst({
            where: {
                id: projectId,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId: userId } } }
                ]
            },
            include: {
                section: {
                    where: {
                        deleted: false,
                        visibility: true,
                    },
                    orderBy: { ranking: "asc" },
                    select: {
                        id: true,
                        section_title: true,
                        ranking: true,
                        projectId: true,
                        visibility: true,
                        deleted: true,
                    },
                },
            },
        })
        return project
    } catch (error) {
        console.log("🚀 ~ getProjectById ~ error:", error)
        return null;
    }

};

export default getProjectById;
