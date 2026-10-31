import { AgentWritingError } from '@/lib/agents/writing'
import { enforceAgentWriting } from '@/lib/agents/writingEnforcement'
import { isPlanLimitReachedError, planLimitResponse } from "@/lib/planLimits";
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next"
import { PrismaClient } from "@prisma/client"
import upsertTaskDescription from "../description/common-description-create";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { waitUntil } from "@vercel/functions";
import { HTPR_7131_INDEX_NEW_TICKETS_FLAG } from "@/lib/flags/definitions/htpr-7131-index-new-tickets";
import { scheduleClassifyNewTaskAiLabels } from "@/lib/ai/labelClassifier";
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

const TASK_UNIQUE_INDEX_ADVISORY_LOCK_CLASS = 9428471;

type TaskDb = Pick<PrismaClient, "task">

export function buildWebhookTaskSnapshot(
  row: {
    id: number;
    ticketNumber: string | null;
    projectId: number;
    title: string;
    status: WebhookTaskSnapshot["status"];
    dueDate: Date | null;
    startDate: Date | null;
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
    startDate: row.startDate ?? null,
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
    teamScope?: AgentTokenTeamScope | null;
  }
export const getUniqueTaskCount = async (
    projectId: number,
    db: TaskDb = prisma
): Promise<number> => {
    return (await getNextUniqueTaskIndex(projectId, db)) - 1;
};

const create = async ({title, description, section, userId, ranking, projectId,sectionId,index,currentUser,agentId,teamScope}:IProps) => {
        try {
            await enforceAgentWriting(userId, agentId, { title, description });
            const allowedProject = await prisma.project.findFirst({
                where: {
                    id: projectId,
                    ...taskWriteAccessWhere(currentUser.id, agentId, teamScope),
                },
                select: { id: true },
            })
            if (!allowedProject)
            return ({
                status:404,
                json:{ message: "Project not found or access denied" }
            })

            recordAgentBoardScopeMiss(allowedProject.id, "write");
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

            let task;
            let boardWebhookDeliveryIds: string[] = [];
            const count  = await prisma.task.count({
                where:{
                    sectionId:sectionId,
                    status:"Normal"
                }
            })
            const body = {title,
                description,
                section,
                userId,
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
                  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TASK_UNIQUE_INDEX_ADVISORY_LOCK_CLASS}::int, ${projectId}::int)`;
                  const getProject = await tx.project.findUnique({ where: { id: projectId }, select: { uniqueIdentifier: true, firstTaskPointerTaskId: true } });
                  const nextUniqueIndex = await getNextUniqueTaskIndex(projectId, tx);
                  const row = await tx.task.create({
                    data: {
                        ...body,
                        uniqueIndex: nextUniqueIndex,
                        ticketNumber:getProject?.uniqueIdentifier+"-"+nextUniqueIndex.toString(),
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
                  await persistAgentTaskCreatedPending(tx, row.id)
                  return { taskId: row.id, firstTaskPointerTaskId: getProject?.firstTaskPointerTaskId ?? null, result: row, webhookTask: buildWebhookTaskSnapshot(row, sectionExists.section_title) }
                }, "web", null, projectId)
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
                  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TASK_UNIQUE_INDEX_ADVISORY_LOCK_CLASS}::int, ${projectId}::int)`;
                  const getProject = await tx.project.findUnique({ where: { id: projectId }, select: { uniqueIdentifier: true, firstTaskPointerTaskId: true } });
                  const nextUniqueIndex = await getNextUniqueTaskIndex(projectId, tx);
                  const row = await tx.task.create({
                    data: {
                        ...body,
                        uniqueIndex: nextUniqueIndex,
                        ticketNumber:getProject?.uniqueIdentifier+"-"+nextUniqueIndex.toString(),
                    },
                    include:{
                        priority:true,
                        project:{select:{teamId:true}},
                        taskLabels:{include:{label:true}}
                    }
                  })
                  await persistAgentTaskCreatedPending(tx, row.id)
                  return { taskId: row.id, firstTaskPointerTaskId: getProject?.firstTaskPointerTaskId ?? null, result: row, webhookTask: buildWebhookTaskSnapshot(row, sectionExists.section_title) }
                }, "web", null, projectId)
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
            waitUntil((async () => {
                if (!await isFeatureEnabled(HTPR_7131_INDEX_NEW_TICKETS_FLAG, currentUser.id)) return;
                const { upsertTaskToTurbopuffer } = await import("@/utils/controllers/turbopuffer/turbopufferHelper");
                await upsertTaskToTurbopuffer(task.id);
            })().catch((error) => console.error("[task-create] search indexing failed", { taskId: task.id, error })));
            scheduleClassifyNewTaskAiLabels(task.id, projectId)

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
                    } else if (recoveryResult === "pending") {
                        console.warn("[task-create] task.created handoff remains pending for the recovery sweep", {
                            taskId: task.id,
                        });
                    }
                } catch (error) {
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
        } catch (error) {
            if (error instanceof AgentWritingError) return { status: 400, json: { message: error.message, code: error.code, field: error.field } };
            if (isPlanLimitReachedError(error)) {
                const refusal = planLimitResponse(error)
                return { status: refusal.status, json: refusal.body }
            }
            console.log(error)
            return ({
                status:500,
                json:{message:"Something Went Wrong!"}
            })
        }

}

export default create;
