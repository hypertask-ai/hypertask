import { NextApiHandler, NextApiRequest, NextApiResponse } from "next"
import { PrismaClient } from "@prisma/client"
import upsertTaskDescription from "../description/common-description-create";
import prisma from "@/lib/prisma";
import { scheduleClassifyTaskAiLabels } from "@/lib/ai/labelClassifier";
import { getNextUniqueTaskIndex } from "./getNextUniqueTaskIndex";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { autoAssignForSection } from "@/utils/controllers/assignees/autoAssignForSection";
import { createTaskWithBoardWebhookOutbox, WebhookTaskSnapshot } from "@/lib/mcp/webhooks/taskEvents";
import { publishBoardWebhookDeliveries } from "@/lib/mcp/webhooks/outbox";
import {
  emitAgentTaskCreatedWebhook,
  markAgentTaskCreatedReady,
  persistAgentTaskCreatedPending,
} from "@/lib/agentWebhooks/outbox";

/** Subset used by uniqueIndex helpers — works with root client and interactive transaction `tx`. */
type TaskDb = Pick<PrismaClient, "task">

// HTPR-5928: builds the task.created webhook payload from the row tx.task.create
// already returned (both branches below `include: { priority: true, ... }`),
// instead of persistTaskCreatedWebhook re-reading the task and its section.
//
// `sectionTitle` is passed in separately rather than read off `row.section`:
// row.section is Task's denormalized string field, written here from the
// caller-supplied `body.section` (IProps.section) — not DB truth. Callers pass
// the title from the Section row they already fetched (`sectionExists`) so a
// stale/renamed client value can't leak into the webhook payload (HTPR-5928
// review).
export function buildWebhookTaskSnapshot(
  row: {
    id: number;
    ticketNumber: string | null;
    projectId: number;
    title: string;
    status: WebhookTaskSnapshot["status"];
    dueDate: Date | null;
    sectionId: number | null;
    priority: { id: string; priority_index: number; Priority_Value: string } | null;
  },
  sectionTitle: string,
): WebhookTaskSnapshot {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    projectId: row.projectId,
    title: row.title,
    status: row.status,
    dueDate: row.dueDate,
    sectionId: row.sectionId,
    section: sectionTitle,
    priority: row.priority,
  };
}
interface IProps {
    title: string;
    description: string;
    section: string; 
    userId: number; 
    ranking: string; 
    projectId: number; 
    sectionId: number; 
    index?:number
    currentUser: { id: number };
    agentId?: string | null;
  }
export const getUniqueTaskCount = async (
    projectId: number,
    db: TaskDb = prisma
): Promise<number> => {
    return (await getNextUniqueTaskIndex(projectId, db)) - 1;
};

const create = async ({title, description, section, userId, ranking, projectId,sectionId,index,currentUser,agentId}:IProps) => {
        try {
            // if (userId===4){
            //     await prisma.task.updateMany({
            //         where:{
            //             updatedAt:null
            //         },
            //         data: {
            //           updatedAt: new Date(), // Set updatedAt to the current date and time
            //         },
            //       });
            //     console.log("Updated")
            // }
            
            const allowedProject = await prisma.project.findFirst({
                where: {
                    id: projectId,
                    ...taskWriteAccessWhere(currentUser.id, agentId),
                },
                select: { id: true },
            })
            if (!allowedProject)
            return ({
                status:404,
                json:{ message: "Project not found or access denied" }
            })

            var taskCount = await getUniqueTaskCount(projectId)
            

            console.log("🚀 ~ create ~ taskCount:", taskCount)


            const sectionExists = await prisma.section.findFirst({
                where:{
                    id:sectionId
                }
            })
            console.log("🚀 ~ create ~ sectionExists:", sectionExists)

            if (!sectionExists) 
            return ({
                status:400,
                json:{ message: "Section Doesn't Exist" }
            })


            
            const currentDate = new Date();

            // return res.status(400).json({ message: "Section Doesn't Exist" });
            let task;
            let boardWebhookDeliveryIds: string[] = [];
            const count  = await prisma.task.count({
                where:{
                    sectionId:sectionId,
                    status:"Normal"
                }
            })
            // ========================== create ticket number (GET PROJECT)
            const getProject = await prisma.project.findUnique({where:{id:projectId}})

            // ------------------- BODY 
            const body = {title,
                description,
                section,
                userId,
                uniqueIndex: taskCount + 1,
                ticketNumber:getProject?.uniqueIdentifier+"-"+(taskCount + 1).toString(),
                ranking,
                projectId,
                sectionId,
                updatedAt: currentDate,}
            console.log("🚀 ~ create ~ body:", body)
            const taskCreatedActor = {
                userId: currentUser.id,
                agentId: agentId ?? null,
            }
            if (index==0 && count!==0){

                const created = await createTaskWithBoardWebhookOutbox(prisma, taskCreatedActor, async (tx) => {
                  const row = await tx.task.create({
                    data: {
                        ...body,
                        priority:{
                            create:{
                                priority_index:1,
                                sectionId:sectionId,
                                Priority_Value:"Urgent",
                                projectId:projectId,
                                addedByUserId:userId
                            }
                        }
                    },
                    include:{
                        priority:true,
                        project:{select:{teamId:true}},
                        taskLabels:{include:{label:true}}
                    }
                  })
                  // Same transaction as the task row, so a subscriber can never
                  // miss task.created for a task that exists (HTPR-4530).
                  await persistAgentTaskCreatedPending(tx, row.id)
                  return { taskId: row.id, result: row, webhookTask: buildWebhookTaskSnapshot(row, sectionExists.section_title) }
                })
                task = created.result
                boardWebhookDeliveryIds = created.boardWebhookDeliveryIds
                await prisma.team_Activity.update({
                    where:{
                        teamId:task.project.teamId??undefined,
                        
                    },
                    data:{
                        total_tasks:{increment:1}
                    }
                })
            }
            else{
                const created = await createTaskWithBoardWebhookOutbox(prisma, taskCreatedActor, async (tx) => {
                  const row = await tx.task.create({
                    data: {
                        ...body  
                    },
                    include:{
                        priority:true,
                        project:{select:{teamId:true}},
                        taskLabels:{include:{label:true}}
                    }
                  })
                  await persistAgentTaskCreatedPending(tx, row.id)
                  return { taskId: row.id, result: row, webhookTask: buildWebhookTaskSnapshot(row, sectionExists.section_title) }
                })
                task = created.result
                boardWebhookDeliveryIds = created.boardWebhookDeliveryIds
                await prisma.team_Activity.update({
                    where:{
                        teamId:task.project.teamId??undefined,
                        
                    },
                    data:{
                        total_tasks:{increment:1}
                    }
                })
            }
            await publishBoardWebhookDeliveries(boardWebhookDeliveryIds)
            
            // =============== also now create task description by default
            await Promise.all([
                upsertTaskDescription({
                    content: "",
                    taskId: task.id,
                    creatorId: userId,
                    actingUserId: currentUser.id,
                }),
                prisma.drafts.create({data:{taskId:task.id,userId:userId, type:"Description", projectId:projectId, saved:false, content:"" }}),
                prisma.drafts.create({data:{taskId:task.id,userId:userId, type:"Comment", projectId:projectId, saved:false }})
            ])
            scheduleClassifyTaskAiLabels(task.id, projectId)

            // The task transaction committed above. Run column auto-assignment
            // first, then build task.created from the final task state.
            // A column rule applies to every ticket that lands in the column,
            // not only to tickets dragged in later (HTPR-5488).
            const autoAssigned = await autoAssignForSection({
                taskId: task.id,
                projectId,
                sectionId,
                currentUserId: currentUser.id,
                agentAssignerId: agentId,
            })
            if (autoAssigned === "pending") {
                console.warn("[task-create] auto-assignment did not complete; retrying the pending task.created handoff", {
                    taskId: task.id,
                });
                try {
                    const { recoverPendingAgentTaskCreatedWebhook } = await import(
                        "@/lib/agentWebhooks/taskCreatedRecovery"
                    );
                    const recoveryResult = await recoverPendingAgentTaskCreatedWebhook(task.id, {
                        userId: currentUser.id,
                        agentId: agentId ?? null,
                    });
                    if (recoveryResult === "recovered") {
                        // The recovery helper emitted task.created after its
                        // final assignment and task-state checks.
                    } else if (recoveryResult === "pending") {
                        // The recovery helper already requeued the marker.
                        console.warn("[task-create] task.created handoff remains pending for the recovery sweep", {
                            taskId: task.id,
                        });
                    }
                } catch (error) {
                    // Keep the creation marker pending. Emitting here could
                    // publish task.created without the final assignees.
                    console.error("[task-create] pending task.created recovery failed", {
                        taskId: task.id,
                        error,
                    });
                    const { ensurePendingAgentTaskCreatedWebhook } = await import(
                        "@/lib/agentWebhooks/outbox"
                    );
                    await ensurePendingAgentTaskCreatedWebhook(task.id).catch(
                        (fallbackError) => {
                            console.error("[task-create] could not requeue pending task.created handoff", {
                                taskId: task.id,
                                error: fallbackError,
                            });
                        },
                    );
                }
            } else {
                try {
                    await markAgentTaskCreatedReady(task.id);
                    await emitAgentTaskCreatedWebhook({
                        taskId: task.id,
                        actor: {
                            userId: currentUser.id,
                            agentId: agentId ?? null,
                        },
                    });
                } catch (error) {
                    // The creation transaction left a pending marker; the minute
                    // sweep retries this handoff if the request path stops here.
                    console.error("[task-create] agent task.created webhook failed", {
                        taskId: task.id,
                        error,
                    });
                    const { ensurePendingAgentTaskCreatedWebhook } = await import(
                        "@/lib/agentWebhooks/outbox"
                    );
                    await ensurePendingAgentTaskCreatedWebhook(task.id).catch(
                        (fallbackError) => {
                            console.error("[task-create] could not requeue failed task.created handoff", {
                                taskId: task.id,
                                error: fallbackError,
                            });
                        },
                    );
                }
            }

            return ({
                status:200,
                json:task
            })
            // return res.json(task)
        } catch (error) {
            console.log(error)
            return ({
                status:500,
                json:{message:"Something Went Wrong!"}
            })
        }

}

export default create;
