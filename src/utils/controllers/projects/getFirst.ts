import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { createProjectViewAndCreateDefault } from "./create";
import { getProjectViewInclude } from "./getAll";
import { enqueueBoardCreated, processAnalyticsIntentSoon } from "@/lib/telemetry/savedWork";

const getFirst = async (userId:number, { withTasks = false }: { withTasks?: boolean } = {}) => {
        try {
            if (!userId) {
                return({
                    status:400,
                    json:{ message: "User id is required" }
                })
            }
            const user = await prisma.user.findUnique({
                where: {
                    id: userId
                }
            })
            if (!user) {
                return({
                    status:400,
                    json:{ message: "User not found" }
                })
            }
            const projectInclude = {
                ...(withTasks ? { tasks: true } : {}),
                section: true,
                ai_custom_instructions: true,
                project_view: getProjectViewInclude({ currentUserId: userId }),
            };

            let project = await prisma.project.findFirst({
                where: {
                    ...projectContentAccessWhere(userId),
                    status: "Normal",
                    googleAccount: { isNot: null },
                    teamId: { not: null },
                },
                include: projectInclude,
            });

            if (!project) {
                project = await prisma.project.findFirst({
                    where: {
                        ...projectContentAccessWhere(userId),
                        status: "Normal",
                    },
                    include: projectInclude,
                    orderBy: { id: "desc" },
                });
            }

            console.log("🚀 ~ getFirst ~ project:", project)
            if (!project) {
                const provisionalName = `n${randomBytes(5).toString("hex")}`;
                const { created, analyticsKey } = await prisma.$transaction(async (tx) => {
                    const created = await tx.project.create({
                        data: {
                            ownerId: userId,
                            name: provisionalName,
                            uniqueIdentifier: "",
                        },
                    });
                    const analyticsKey = await enqueueBoardCreated(tx, created.id, "auto", { userId });
                    return { created, analyticsKey };
                });
                processAnalyticsIntentSoon(analyticsKey);
                await prisma.project.update({
                    where: { id: created.id },
                    data: { name: `project-${created.id}` },
                });
                await createProjectViewAndCreateDefault({
                    projectId: created.id,
                    userId,
                });
                project = await prisma.project.findFirst({
                    where: { id: created.id },
                    include: projectInclude,
                });
            }
            return({
                status:200,
                json:sanitizeProjectBoardFilters(project, userId)
            })
        } catch (error) {
            console.log(error);
            return({
                status:400,
                json:{ message: JSON.stringify(error) }
            })
        }
    
};

export default getFirst;