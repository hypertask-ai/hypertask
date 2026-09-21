import prisma from '@/lib/prisma';
import { getUniqueTaskCount } from './create';
import generateRank from '@/utils/generateRank';
import upsertTaskDescription from '@/utils/controllers/description/common-description-create';
import { PriorityConstants, EstimateConstants } from '@/lib/constants/constants';
import { autoAssignForSection } from '@/utils/controllers/assignees/autoAssignForSection';
import { createTaskWithBoardWebhookOutbox } from '@/lib/mcp/webhooks/taskEvents';
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

/**
 * Core task creation logic shared between UI and MCP endpoints
 * Extracted from createGlobally.ts to avoid duplication
 */
export async function createTaskCore(options: CreateTaskCoreOptions): Promise<CreateTaskCoreResult> {
    const {
        title,
        description,
        userId,
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

    // Generate unique task count and ticket number
    const taskCount = await getUniqueTaskCount(projectId);
    const ticketNumber = `${projectIdentifier}-${taskCount + 1}`;

    // Generate ranking if not provided
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

    // Labels are project-scoped rows; connect by id (used by recurrence spawn
    // and template instantiation).
    if (labelIds && labelIds.length > 0) {
        taskData.taskLabels = {
            create: labelIds.map((labelId) => ({ labelId }))
        };
    }

    // Add priority if provided
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

    // Add estimate if provided
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

    // Create task. The board webhook rows are written in the same transaction so
    // the task and its task.created event can never exist without each other.
    const taskCreatedActor = { userId, agentId: null };
    const createdTask = await createTaskWithBoardWebhookOutbox(prisma, taskCreatedActor, async (tx) => {
        const created = await tx.task.create({
            data: taskData,
            include: {
                project: {
                    select: {
                        teamId: true
                    }
                },
                // Needed for the task.created webhook payload (HTPR-5928) — taskData
                // can nest a priority create above, and without this include Prisma
                // won't return it on the created row.
                priority: {
                    select: { id: true, priority_index: true, Priority_Value: true }
                }
            }
        });
        await persistAgentTaskCreatedPending(tx, created.id);
        return { taskId: created.id,
            result: created,
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
    });
    const newTask = createdTask.result;
    const boardWebhookDeliveryIds = createdTask.boardWebhookDeliveryIds;
    await publishBoardWebhookDeliveries(boardWebhookDeliveryIds);

    if (!newTask) {
        throw new Error('Failed to create task');
    }

    // Create description
    const description_ = await upsertTaskDescription({
        taskId: newTask.id,
        creatorId: userId,
        content: description,
        actingUserId: userId
    });

    // Update team activity (fire-and-forget)
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

    // Create drafts if requested (for UI-driven creation)
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

    // A column rule applies to every ticket that lands in the column, not only
    // to tickets dragged in later (HTPR-5488).
    const autoAssigned = await autoAssignForSection({
        taskId: newTask.id,
        projectId,
        sectionId,
        currentUserId: userId
    });
    if (autoAssigned === 'pending') {
        console.warn('[task-create-core] auto-assignment did not complete; retrying the pending task.created handoff', {
            taskId: newTask.id,
        });
        try {
            const { recoverPendingAgentTaskCreatedWebhook } = await import(
                '@/lib/agentWebhooks/taskCreatedRecovery'
            );
            const recoveryResult = await recoverPendingAgentTaskCreatedWebhook(newTask.id, {
                userId,
            });
            if (recoveryResult === 'recovered') {
                // The recovery helper emitted task.created after its final
                // assignment and task-state checks.
            } else if (recoveryResult === 'pending') {
                // The recovery helper already requeued the marker.
                console.warn('[task-create-core] task.created handoff remains pending for the recovery sweep', {
                    taskId: newTask.id,
                });
            }
        } catch (error) {
            // Keep the creation marker pending. Emitting here could publish
            // task.created without the final assignees.
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
        // The outbox query runs after auto-assignment and reads final assignees and
        // labels from the task before creating the task.created delivery.
        try {
            await markAgentTaskCreatedReady(newTask.id);
            await emitAgentTaskCreatedWebhook({
                taskId: newTask.id,
                actor: { userId },
            });
        } catch (error) {
            // The creation transaction left a pending marker; the minute sweep
            // retries this handoff if the request path stops here.
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
