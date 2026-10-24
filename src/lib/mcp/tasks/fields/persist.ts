import { isPlanLimitReachedError, planLimitResponse } from "@/lib/planLimits";
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';
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

function isCallerRefusal(error: unknown): error is Error & { status: number; code: string } {
    const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown }
    return error instanceof Error && typeof status === 'number' && status >= 400 && status < 500 && typeof code === 'string'
}

export async function persistTaskUpdates(context: TaskUpdateFieldContext, tasks: TaskUpdateTarget[]): Promise<UpdateTaskResponse> {
    const { ctx, user, requestBody, hasDueDate } = context;
    const actingAgent = ctx.agentId
        ? await prisma.agent.findUnique({
            where: { id: ctx.agentId, revokedAt: null },
            select: actingAgentSelect,
        })
        : null;
    const updatePromises: Promise<TaskUpdateResult>[] = tasks.map(
        async (task): Promise<TaskUpdateResult> => {
        try {
            const actingAgentId = ctx.agentId
            if (actingAgentId) {
                await prisma.$transaction((tx) =>
                    assertAgentAssignmentChangeAllowed(
                        tx,
                        task.id,
                        actingAgentId,
                        user.id,
                        { teamScope: ctx.teamScope },
                    )
                )
            }

            await updateTaskSection(context, task);
            await updateTaskStatus(context, task);
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
            if (isPlanLimitReachedError(error)) {
                const refusal = planLimitResponse(error);
                return { ...refusal.body, taskId: task.id, status: refusal.status };
            }
            const codedError = error instanceof PullRequestLinkError || isCallerRefusal(error) ? error : null
            const callerMistake = codedError !== null && codedError.status < 500
            const log = callerMistake ? console.warn : console.error
            log(`[MCP Update Task] ${callerMistake ? 'Refused update of' : 'Error updating'} task ${task.id}:`, error)
            return {
                success: false,
                taskId: task.id,
                error: toErrorMessage(error, 'Unknown error'),
                ...(codedError
                    ? { status: codedError.status, code: codedError.code }
                    : {}),
            }
        }
    })

    const updateResults = await Promise.all(updatePromises)
    const updatedTaskIds = updateResults
        .filter(result => result.success)
        .map(result => result.taskId)
    
    const failedTasks = updateResults.filter(result => !result.success)
    const unexpectedFailures = failedTasks.filter((failure) => !isPlanLimitReachedError(failure))
    if (unexpectedFailures.length > 0) {
        console.warn(`[MCP Update Task] ${unexpectedFailures.length} task(s) failed to update:`, unexpectedFailures)
    }

    if (updatedTaskIds.length === 0) {
        const errorMessages = failedTasks.map(ft => ft.error).filter(Boolean)
        const isCoded = (failure: (typeof failedTasks)[number]) => failure.status !== undefined && failure.code !== undefined
        const linkFailure = failedTasks.every(isCoded) ? failedTasks[0] : undefined
        const planFailure = failedTasks.find(isPlanLimitReachedError)
        if (isPlanLimitReachedError(planFailure)) {
            const refusal = planLimitResponse(planFailure)
            throw new UpdateTaskPersistenceError({ ...refusal.body, tasks: [] }, refusal.status)
        }
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

    const updatedTasks = await prisma.task.findMany({
        where: { id: { in: updatedTaskIds }, ...(ctx.teamScope == null ? {} : { project: getProjectWhere(user.id, ctx.agentId, ctx.teamScope) }) },
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

    await broadcastTaskUpdates(updatedTasks, user.id)

    const mappedTasks = updatedTasks.map((task) => mapTaskToDetail(task, user.id))
    
    let message = `${updatedTasks.length} task(s) updated successfully`
    if (failedTasks.length > 0) {
        message += ` (${failedTasks.length} task(s) failed)`
    }
    
    const sessionAgent = await getMcpSessionAgentSummary(ctx.agentId, user.id);

    const partialPlanFailure = failedTasks.find(isPlanLimitReachedError)
    if (isPlanLimitReachedError(partialPlanFailure)) {
        const refusal = planLimitResponse(partialPlanFailure)
        throw new UpdateTaskPersistenceError({ ...refusal.body, tasks: mappedTasks }, refusal.status)
    }

    const mcpResponse: UpdateTaskResponse = {
        success: true,
        tasks: mappedTasks,
        ...(mappedTasks.length === 1 ? { task: mappedTasks[0] } : {}),
        message,
        ...(failedTasks.length
            ? {
                  failed_tasks: failedTasks.map((failure) => ({
                      taskId: failure.taskId,
                      error: failure.error,
                      status: failure.status,
                      code: failure.code,
                      ...(isPlanLimitReachedError(failure) ? planLimitResponse(failure).body : {}),
                  })),
              }
            : {}),
        ...(sessionAgent ? { agent: sessionAgent } : {}),
    }

    return mcpResponse
    }

