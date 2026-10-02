import { getMcpSessionAgentSummary } from "@/lib/mcp/agents";
import prisma from "@/lib/prisma";
import { mapTaskToDetail, taskDetailInclude } from "@/lib/mcp/tasks/mappers";
import { broadcastTaskUpdates } from "@/lib/mcp/tasks/broadcastTaskUpdates";
import { assertAgentAssignmentChangeAllowed } from "@/lib/mcp/tasks/agentMutationFence";
import { toErrorMessage } from "@/lib/api/errorMessage";
import { actingAgentSelect } from "@/lib/agents/activityAttribution";
import { PullRequestLinkError } from "@/lib/pullRequests/taskPullRequests";
import { UpdateTaskPersistenceError, type TaskUpdateFieldContext, type TaskUpdateTarget, type TaskUpdateResult, type UpdateTaskResponse } from './types';
import { updateTaskSection } from './section';
import { updateTaskStatus } from './status';
import { updateTaskText } from './text';
import { updateTaskDueDate } from './dueDate';
import { updateTaskPriority } from './priority';
import { updateTaskEstimate } from './estimate';
import { updateTaskLabels } from './labels';
import { updateTaskContract } from './contract';
import { updateTaskPullRequest } from './pullRequest';
import { updateTaskAssignees } from './assignees';

export async function persistTaskUpdates(context: TaskUpdateFieldContext, tasks: TaskUpdateTarget[]): Promise<UpdateTaskResponse> {
    const { ctx, user, requestBody, hasDueDate } = context;
    const actingAgent = ctx.agentId
        ? await prisma.agent.findUnique({
            where: { id: ctx.agentId, revokedAt: null },
            select: actingAgentSelect,
        })
        : null;
    // Update all tasks in parallel
    const updatePromises: Promise<TaskUpdateResult>[] = tasks.map(
        async (task): Promise<TaskUpdateResult> => {
        try {
            // The writes below are internal HTTP requests, and the one-shot
            // lease adoption this request was granted lives in AsyncLocalStorage,
            // which does not survive a new request. Without a real lease row the
            // internal call fences itself out and the whole update fails. So
            // spend the adoption here, in-process, and let the internal requests
            // find the live lease it creates.
            const actingAgentId = ctx.agentId
            if (actingAgentId) {
                await prisma.$transaction((tx) =>
                    assertAgentAssignmentChangeAllowed(
                        tx,
                        task.id,
                        actingAgentId,
                        user.id
                    )
                )
            }

            await updateTaskSection(context, task);
            await updateTaskStatus(context, task);
            // 3. Other fields (title, description, due_date): use single endpoint
            const dueDateValue = hasDueDate
                ? (requestBody.due_date === null ? null : new Date(requestBody.due_date!.trim()))
                : undefined
            await updateTaskText(context, task);
            await updateTaskDueDate(context, task, dueDateValue);
            await updateTaskPriority(context, task);
            await updateTaskEstimate(context, task);
            await updateTaskLabels(context, task, actingAgent);
            await updateTaskContract(context, task);
            await updateTaskPullRequest(context, task);
            await updateTaskAssignees(context, task);

            return { success: true, taskId: task.id }
        } catch (error) {
            console.error(`[MCP Update Task] Error updating task ${task.id}:`, error)
            const linkError = error instanceof PullRequestLinkError ? error : null
            return {
                success: false,
                taskId: task.id,
                error: toErrorMessage(error, 'Unknown error'),
                ...(linkError
                    ? { status: linkError.status, code: linkError.code }
                    : {}),
            }
        }
    })

    // Wait for all updates to complete (using allSettled to handle partial failures)
    const updateResults = await Promise.all(updatePromises)
    const updatedTaskIds = updateResults
        .filter(result => result.success)
        .map(result => result.taskId)
    
    const failedTasks = updateResults.filter(result => !result.success)
    if (failedTasks.length > 0) {
        console.warn(`[MCP Update Task] ${failedTasks.length} task(s) failed to update:`, failedTasks)
    }

    // If all tasks failed, return an error
    if (updatedTaskIds.length === 0) {
        const errorMessages = failedTasks.map(ft => ft.error).filter(Boolean)
        const linkFailure = failedTasks.find(
            (failure) => failure.status !== undefined && failure.code !== undefined,
        )
        throw new UpdateTaskPersistenceError(
            {
                success: false,
                tasks: [],
                error: `Failed to update ${failedTasks.length} task(s). ${errorMessages.length > 0 ? errorMessages[0] : 'Unknown error'}`,
                ...(linkFailure?.code ? { code: linkFailure.code } : {}),
            },
            linkFailure?.status ?? 500,
        )
    }

    // Fetch complete tasks with all relations for MCP response format
    const updatedTasks = await prisma.task.findMany({
        where: { id: { in: updatedTaskIds } },
        include: taskDetailInclude(user.id)
    })

    if (updatedTasks.length === 0) {
        return {
            success: true,
            tasks: [],
            message: 'Tasks were updated but could not be retrieved'
        }
    }

    console.log('[MCP Update Task] Tasks updated successfully:', updatedTaskIds)

    // Wait for every delivery attempt before returning success. Otherwise the
    // serverless request can finish before external CLI/MCP changes are emitted.
    await broadcastTaskUpdates(updatedTasks, user.id)

    const mappedTasks = updatedTasks.map((task) => mapTaskToDetail(task, user.id))
    
    let message = `${updatedTasks.length} task(s) updated successfully`
    if (failedTasks.length > 0) {
        message += ` (${failedTasks.length} task(s) failed)`
    }
    
    const sessionAgent = await getMcpSessionAgentSummary(ctx.agentId, user.id);

    const mcpResponse: UpdateTaskResponse = {
        success: true,
        tasks: mappedTasks,
        // Backward compatibility: include single task field when only one task is updated
        ...(mappedTasks.length === 1 ? { task: mappedTasks[0] } : {}),
        message,
        ...(failedTasks.length
            ? {
                  failed_tasks: failedTasks.map(({ taskId, error, status, code }) => ({
                      taskId,
                      error,
                      status,
                      code,
                  })),
              }
            : {}),
        ...(sessionAgent ? { agent: sessionAgent } : {}),
    }

    return mcpResponse
    }

