import prisma from '@/lib/prisma';
import { isFeatureEnabled } from '@/lib/flags';
import { waitUntil } from '@vercel/functions';
import { HTPR_7131_INDEX_NEW_TICKETS_FLAG } from '@/lib/flags/definitions/htpr-7131-index-new-tickets';
import { getUniqueTaskCount } from './create';
import generateRank from '@/utils/generateRank';
import upsertTaskDescription from '@/utils/controllers/description/common-description-create';
import { PriorityConstants, EstimateConstants } from '@/lib/constants/constants';
import { autoAssignForSection } from '@/utils/controllers/assignees/autoAssignForSection';
import { createTaskWithBoardWebhookOutbox, createProvisionedTaskWithBoardWebhookOutbox } from '@/lib/mcp/webhooks/taskEvents';
import type { CreationChannel } from '@/lib/telemetry/savedWork';
import { publishBoardWebhookDeliveries } from '@/lib/mcp/webhooks/outbox';
import {
    emitAgentTaskCreatedWebhook,
    markAgentTaskCreatedReady,
    persistAgentTaskCreatedPending,
} from '@/lib/agentWebhooks/outbox';

export interface CreateTaskCoreOptions {
    title: string;
    description: string;
    userId: number;
    actingUserId?: number;
    actingAgentId?: string | null;
    agentId?: string | null;
    creationChannel: CreationChannel;
    projectId: number;
    sectionId: number;
    sectionTitle: string;
    projectIdentifier: string;
    ranking?: string;
    priorityIndex?: number;
    estimateIndex?: number;
    dueDate?: Date;
    startDate?: Date;
    recurrence?: string | null;
    labelIds?: string[];
    createDrafts?: boolean;
    updateTeamActivity?: boolean;
}

export interface CreateTaskCoreResult {
    task: any;
    description: any;
}

export async function createTaskCore(options: CreateTaskCoreOptions): Promise<CreateTaskCoreResult> {
    return createTaskCoreWithWriter(options, createTaskWithBoardWebhookOutbox);
}

export async function createProvisionedTaskCore(options: CreateTaskCoreOptions): Promise<CreateTaskCoreResult> {
    return createTaskCoreWithWriter(options, createProvisionedTaskWithBoardWebhookOutbox);
}

async function createTaskCoreWithWriter(options: CreateTaskCoreOptions, writeTask: typeof createTaskWithBoardWebhookOutbox): Promise<CreateTaskCoreResult> {
    const {
        title,
        description,
        userId,
        agentId,
        creationChannel,
        projectId,
        sectionId,
        sectionTitle,
        projectIdentifier,
        ranking: providedRanking,
        priorityIndex = 0,
        estimateIndex = 0,
        dueDate,
        startDate,
        recurrence,
        labelIds,
        createDrafts = true,
        updateTeamActivity = true
    } = options;

    const taskCount = await getUniqueTaskCount(projectId);
    const ticketNumber = `${projectIdentifier}-${taskCount + 1}`;

    let ranking = providedRanking;
    if (!ranking) {
        const lastTask = await prisma.task.findFirst({
            where: {
                sectionId,
                projectId,
                status: 'Normal'
            },
            orderBy: { ranking: 'desc' },
            select: { ranking: true }
        });
        ranking = generateRank(lastTask?.ranking, undefined);
    }

    const currentDate = new Date();
    const taskData: any = {
        title,
        description: '',
        section: sectionTitle,
        userId,
        agentId: agentId ?? null,
        uniqueIndex: taskCount + 1,
        ticketNumber,
        ranking,
        projectId,
        sectionId,
        status: 'Normal',
        dueDate,
        startDate,
        recurrence: recurrence ?? null,
        dueDateNotifiedAt: null,
        updatedAt: currentDate,
        createdAt: currentDate
    };

    if (labelIds && labelIds.length > 0) {
        taskData.taskLabels = {
            create: labelIds.map((labelId) => ({ labelId }))
        };
    }

    if (priorityIndex > 0) {
        const priorityConstant = PriorityConstants.find(p => p.priority_index === priorityIndex);
        if (priorityConstant) {
            taskData.priority = {
                create: {
                    priority_index: priorityConstant.priority_index,
                    Priority_Value: priorityConstant.Priority_Value,
                    sectionId,
                    projectId,
                    addedByUserId: userId
                }
            };
        }
    }

    if (estimateIndex > 0) {
        const estimateConstant = EstimateConstants.find(e => e.estimate_index === estimateIndex);
        if (estimateConstant) {
            taskData.estimate = {
                create: {
                    estimate_index: estimateConstant.estimate_index,
                    estimate_value: estimateConstant.estimate_value,
                    estimate_full_value: estimateConstant.estimate_full_value,
                    projectId,
                    addedByUserId: userId,
                    sectionId
                }
            };
        }
    }

    const taskCreatedActor = { userId, agentId: agentId ?? null, actingUserId: options.actingUserId, actingAgentId: options.actingAgentId };
    const createdTask = await writeTask(prisma, taskCreatedActor, async (tx) => {
        const created = await tx.task.create({
            data: taskData,
            include: {
                project: {
                    select: {
                        teamId: true,
                        firstTaskPointerTaskId: true
                    }
                },
                priority: {
                    select: { id: true, priority_index: true, Priority_Value: true }
                }
            }
        });
        await persistAgentTaskCreatedPending(tx, created.id);
        return { taskId: created.id,
            firstTaskPointerTaskId: created.project.firstTaskPointerTaskId,
            result: { ...created, project: { teamId: created.project.teamId } },
            webhookTask: {
                id: created.id,
                ticketNumber: created.ticketNumber,
                projectId: created.projectId,
                title: created.title,
                status: created.status,
                dueDate: created.dueDate,
                startDate: created.startDate ?? null,
                sectionId: created.sectionId,
                section: created.section,
                priority: created.priority
                    ? {
                        id: created.priority.id,
                        priority_index: created.priority.priority_index,
                        Priority_Value: created.priority.Priority_Value
                    }
                    : null
            }
        };
    }, creationChannel, null, projectId);
    const newTask = createdTask.result;
    const boardWebhookDeliveryIds = createdTask.boardWebhookDeliveryIds;
    await publishBoardWebhookDeliveries(boardWebhookDeliveryIds);

    if (!newTask) {
        throw new Error('Failed to create task');
    }

    const description_ = await upsertTaskDescription({
        taskId: newTask.id,
        creatorId: userId,
        content: description,
        agentId,
        actingUserId: userId
    });

    waitUntil((async () => {
        if (!await isFeatureEnabled(HTPR_7131_INDEX_NEW_TICKETS_FLAG, userId)) return;
        const { upsertTaskToTurbopuffer } = await import('@/utils/controllers/turbopuffer/turbopufferHelper');
        await upsertTaskToTurbopuffer(newTask.id);
    })().catch((error) => console.error('[task-create-core] search indexing failed', { taskId: newTask.id, error })));

    if (updateTeamActivity && newTask.project?.teamId) {
        prisma.team_Activity.update({
            where: {
                teamId: newTask.project.teamId
            },
            data: {
                total_tasks: { increment: 1 }
            }
        });
    }

    if (createDrafts) {
        prisma.drafts.create({
            data: {
                taskId: newTask.id,
                userId,
                type: 'Comment',
                projectId,
                saved: false
            }
        });

        prisma.drafts.create({
            data: {
                taskId: newTask.id,
                userId,
                type: 'Description',
                projectId,
                saved: false,
                content: ''
            }
        });
    }

    const autoAssigned = await autoAssignForSection({
        taskId: newTask.id,
        projectId,
        sectionId,
        currentUserId: userId,
        agentAssignerId: agentId
    });
    if (autoAssigned === 'pending') {
        console.warn('[task-create-core] auto-assignment did not complete; retrying the pending task.created handoff', {
            taskId: newTask.id,
        });
        try {
            const { recoverPendingAgentTaskCreatedWebhook } = await import(
                '@/lib/agentWebhooks/taskCreatedRecovery'
            );
            const recoveryResult = await recoverPendingAgentTaskCreatedWebhook(newTask.id, taskCreatedActor);
            if (recoveryResult === 'recovered') {
            } else if (recoveryResult === 'pending') {
                console.warn('[task-create-core] task.created handoff remains pending for the recovery sweep', {
                    taskId: newTask.id,
                });
            }
        } catch (error) {
            console.error('[task-create-core] pending task.created recovery failed', {
                taskId: newTask.id,
                error,
            });
            const { ensurePendingAgentTaskCreatedWebhook } = await import(
                '@/lib/agentWebhooks/outbox'
            );
            await ensurePendingAgentTaskCreatedWebhook(newTask.id).catch(
                (fallbackError) => {
                    console.error('[task-create-core] could not requeue pending task.created handoff', {
                        taskId: newTask.id,
                        error: fallbackError,
                    });
                },
            );
        }
    } else {
        try {
            await markAgentTaskCreatedReady(newTask.id);
            await emitAgentTaskCreatedWebhook({
                taskId: newTask.id,
                actor: taskCreatedActor,
            });
        } catch (error) {
            console.error('[task-create-core] agent task.created webhook failed', {
                taskId: newTask.id,
                error,
            });
            const { ensurePendingAgentTaskCreatedWebhook } = await import(
                '@/lib/agentWebhooks/outbox'
            );
            await ensurePendingAgentTaskCreatedWebhook(newTask.id).catch(
                (fallbackError) => {
                    console.error('[task-create-core] could not requeue failed task.created handoff', {
                        taskId: newTask.id,
                        error: fallbackError,
                    });
                },
            );
        }
    }

    return {
        task: newTask,
        description: description_
    };
}
