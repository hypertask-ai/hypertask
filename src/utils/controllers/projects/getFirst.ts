import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { getProjectWhere, projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { createProvisionedProjectWithStableName } from "./createProjectWithStableName";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7799_PROJECT_ENTRY_FLAG } from "@/lib/flags/keys";
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

            const projectEntryEnabled = await isFeatureEnabled(HTPR_7799_PROJECT_ENTRY_FLAG, userId);
            const accessWhere = projectEntryEnabled ? getProjectWhere(userId) : projectContentAccessWhere(userId);
            let project = await prisma.project.findFirst({
                where: {
                    ...accessWhere,
                    status: "Normal",
                    googleAccount: { isNot: null },
                    teamId: { not: null },
                },
                include: projectInclude,
            });

            if (!project) {
                project = await prisma.project.findFirst({
                    where: {
                        ...accessWhere,
                        status: "Normal",
                    },
                    include: projectInclude,
                    orderBy: { id: "desc" },
                });
            }

            console.log("🚀 ~ getFirst ~ project:", project)
            if (!project && projectEntryEnabled) return { status: 200, json: null };
            if (!project) {
                const { created, analyticsKey } = await prisma.$transaction(async (tx) => {
                    const created = await createProvisionedProjectWithStableName({
                        ownerId: userId,
                        uniqueIdentifier: "",
                    }, tx);
                    const analyticsKey = await enqueueBoardCreated(tx, created.id, "auto", { userId });
                    return { created, analyticsKey };
                });
                await createProjectViewAndCreateDefault({
                    projectId: created.id,
                    userId,
                });
                processAnalyticsIntentSoon(analyticsKey);
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