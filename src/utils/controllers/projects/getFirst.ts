import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { createProjectViewAndCreateDefault } from "./create";
import { getProjectViewInclude } from "./getAll";

const membershipOrOwnership = (userId: number) => ({
    OR: [
        { ownerId: parseInt(userId.toString(), 10) },
        { members: { some: { userId } } },
    ],
});

const getFirst = async (userId:number) => {
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
                tasks: true,
                section: true,
                ai_custom_instructions: true,
                project_view: getProjectViewInclude({ currentUserId: userId }),
            };

            // Prefer a fully-linked board (team + calendar account) for integrations.
            let project = await prisma.project.findFirst({
                where: {
                    ...membershipOrOwnership(userId),
                    status: "Normal",
                    googleAccount: { isNot: null },
                    teamId: { not: null },
                },
                include: projectInclude,
            });

            // Auto-created fallbacks (e.g. legacy getFirst) often have null teamId/title.
            // Re-use the latest Normal board instead of creating another orphan on every call —
            // otherwise getAll (which filters teamId) stays empty and the client/server loop
            // keeps inserting duplicate `project-*` rows.
            if (!project) {
                project = await prisma.project.findFirst({
                    where: {
                        ...membershipOrOwnership(userId),
                        status: "Normal",
                    },
                    include: projectInclude,
                    orderBy: { id: "desc" },
                });
            }

            console.log("🚀 ~ getFirst ~ project:", project)
            if (!project) {
                // `Project.name` is globally @unique. `project-${count + 1}` races and can
                // collide with existing rows; mirror create.ts: provisional name, then `project-${id}`.
                const provisionalName = `n${randomBytes(5).toString("hex")}`;
                const created = await prisma.project.create({
                    data: {
                        ownerId: userId,
                        name: provisionalName,
                        uniqueIdentifier: "",
                    },
                });
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
                json:project
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