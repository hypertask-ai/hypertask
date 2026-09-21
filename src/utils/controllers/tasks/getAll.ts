import {  PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";


const tasksGetAll = async (projectId:number|string|string[], userId:number|string|string[]) => {

        try {

            const projectIdNum = Array.isArray(projectId) ? NaN : Number(projectId)
            const userIdNum = Array.isArray(userId) ? NaN : Number(userId)
            if (
                !Number.isInteger(projectIdNum) ||
                projectIdNum < 1 ||
                !Number.isInteger(userIdNum) ||
                userIdNum < 1
            ) {
                return({
                    status:200,
                    json:[]
                })
            }

            const tasks = await prisma.task.findMany({
                where: {
                    projectId: projectIdNum,
                    status: 'Normal',
                    // Scope to projects the requesting user owns or is a member of, so a
                    // caller cannot read another tenant's board by passing an arbitrary
                    // projectId (HTPR-3962). Mirrors the getProjectWhere scoping used by
                    // the MCP task routes and the archived-tasks loader.
                    project: getProjectWhere(userIdNum),
                },
                select: {
                    id: true,
                    title: true,
                    uniqueIndex: true,
                    ranking: true,
                    userId: true,
                    projectId: true,
                    section: true,
                    sectionId:true,
                    createdAt: true,
                    sectionChangedAt: true,
                    lastCommentAt: true,
                    assignees: {
                        where: {
                            OR: [
                                { agentId: null },
                                {
                                    agent: boardAgentVisibilityWhere(userIdNum),
                                },
                            ],
                        },
                        select: {
                            user: true
                        }
                    },
                    comments: {
                        select: {
                            id: true,
                            notifications: {
                                select: { id: true },
                                where: {
                                    seen: false,
                                    userId: userIdNum,
                                }
                            }
                        }
                    },
                    subTasks: {
                        where:{
                            status:{
                                not: "Deleted"
                            }
                        },
                        orderBy:{
                            createdAt:'asc'
                        }
                    },
                    parentTask: {
                        include:{
                            subTasks:{where:{status:{not:"Deleted"}}},
                        }
                    },
  
                },
                orderBy: {
                    ranking: 'asc'
                }
            })
            return({
                status:200,
                json:tasks
            })
            // return res.status(200).json(tasks);
        } catch (error) {
            console.log(error);
            return({
                status:200,
                json:[]
            })
            // return res.status(200).json([]);
        }
   
};

export default tasksGetAll;
