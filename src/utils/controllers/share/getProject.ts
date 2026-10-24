import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { stripForeignTaskRelations } from "@/lib/tasks/sameBoardRelations";
import prisma from "@/lib/prisma";
import { IProject, ISection, ITask } from "@/models/model";
import { getCurrentProject } from "@/utils/helperFunctions/helperFunctions";
import { getFilteredSections } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { getAppliedSubtaskSections } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import { getFilteredEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import { getProjectViewBaseInclude } from "../projects/getAllIncludes";

export default async function getProject(shareId: string) {
    try {
        const inviteObj = await prisma.invite.findFirst({
            where: {
                id: shareId
            },
            select: {
                expired: true,
                projectId: true,
                userId: true,
            },
        })

        if (!inviteObj) {
            return ({
                status: 404,
                json: { message: "Invite not found" }
            })
        }

        if (inviteObj.expired) {
            return ({
                status: 400,
                json: { message: "Invite link has expired or is invalid" }
            })
        }


        const projectId = inviteObj.projectId;

        const loadedProject = await prisma.project.findFirst({
            where: {
                id: projectId,
            },
            include: {
                tasks: {
                    include: {
                        assignees: {
                            select: {
                                userId: true,
                                agentId: true,
                                user: {
                                    select: {
                                        id: true,
                                        photoURL: true,
                                    }
                                }
                            }
                        },
                        taskLabels: {
                            select: {
                                id: true,
                                label: { select: { value: true } },
                            }
                        },

                        priority: { select: { priority_index: true } },
                        estimate: { select: { estimate_index: true } },
                        _count: {
                            select: {
                                comments: {
                                    where: {
                                        creatorId: { not: null }
                                    }
                                },
                            }
                        },
                        subTasks: {
                            where: {
                                status: {
                                    not: "Deleted"
                                }
                            },
                            orderBy: {
                                createdAt: 'asc'
                            }
                        },
                        parentTask: {
                            include: {
                                subTasks: { where: { status: { not: "Deleted" } } },
                            }
                        },

                    },
                    where: {
                        status: 'Normal',
                    },

                },
                members: {
                    select: {
                        id: true,
                        user: {
                            select: {
                                id: true,
                                photoURL: true,
                            }
                        }
                    }
                },
                owner: {
                    select: {
                        id: true,
                        photoURL: true,
                    }
                },
                _count: {
                    select: {
                        section: {
                            where: {
                                deleted: false,
                                visibility: false,
                            }
                        }
                    }
                },
                section: {
                    where: {
                        deleted: false,
                    },
                    orderBy: {
                        ranking: "asc"
                    }
                },
                project_view: getProjectViewBaseInclude({currentUserId:inviteObj.userId}),
            },
        })

        const project = sanitizeProjectBoardFilters(loadedProject, undefined, true);
        if (!project) {
            return ({
                status: 404,
                json: { message: "Project not found" }
            })
        }

        if (project.tasks) project.tasks = project.tasks.map(stripForeignTaskRelations);

        const projectAsIProject = project as unknown as IProject;
        const sections = getCurrentProject(projectAsIProject);

        if (sections) {
            const { _sections, firstTask } = sections as {
                _sections: ISection[];
                firstTask: ITask | null;
            };

            projectAsIProject.sections = _sections;
            projectAsIProject.firstTask = firstTask;

            projectAsIProject.filteredSections = getFilteredSections(_sections, projectAsIProject);
            projectAsIProject.filteredSections = getAppliedSubtaskSections(projectAsIProject.filteredSections, projectAsIProject);
            projectAsIProject.filteredSections = getFilteredEmptySections(projectAsIProject.filteredSections, projectAsIProject);
        }

        return ({
            status: 200,
            json: project
        })
    } catch (error) {
        console.log(error);
        return ({
            status: 400,
            json: { message: JSON.stringify(error) }
        })
    }
}
