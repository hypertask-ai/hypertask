import { EstimateConstants, PriorityConstants } from "@/lib/constants/constants";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { buildFieldError } from "@/lib/mcp/fieldError";
import { requireRole } from "@/lib/mcp/agents/scopes";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import { hasActiveTaskOnlyMutation, isActiveTaskMutationTarget } from "@/lib/mcp/tasks/activeTaskMutation";
import { linkTaskPullRequest } from "@/lib/pullRequests/taskPullRequests";
import { validateTaskUpdateFields } from './fields/validateFields';
import { validateTaskUpdateIdentifiers } from './fields/validateIdentifiers';
import { findTasksByIdentifier } from './fields/findTasks';
import { persistTaskUpdates as persistUpdates } from './fields/persist';
import { UpdateTaskPersistenceError, type ExecuteTaskUpdateOptions, type TaskUpdateExecutionResult, type UpdateTaskResponse } from './fields/types';

export type { UpdateTaskResponse, UpdateTaskBody, TaskUpdateExecutionResult, TaskUpdateAssigneeHandler, TaskClearAssigneesHandler } from './fields/types';

export async function executeTaskUpdate({
    request,
    ctx,
    requestBody,
    dryRun = false,
    assignAssignees,
    clearAssignees,
    linkPullRequest = linkTaskPullRequest,
    strictSideEffectFailures = false,
    persist,
}: ExecuteTaskUpdateOptions): Promise<TaskUpdateExecutionResult> {
    const user = ctx.user;
    let outcome: TaskUpdateExecutionResult['outcome'] = 'success';

    const response = await (async (): Promise<NextResponse> => {

    if (ctx.agentId) {
        const scopeError = await requireRole(ctx, 'write')
        if (scopeError) return scopeError
    }

    const fields = await validateTaskUpdateFields(requestBody, dryRun);
    if (fields instanceof NextResponse) return fields;
    const identifiers = validateTaskUpdateIdentifiers(requestBody, dryRun, fields);
    if (identifiers instanceof NextResponse) return identifiers;
    const { priorityIndex, task_id, ticket_number, unique_index, project_id, normalizedRequestBody } = identifiers;

    // Find tasks by identifier
    const tasks = await findTasksByIdentifier(
        user,
        {
            task_id,
            ticket_number,
            unique_index,
            project_id,
        },
        ctx.agentId
    )

    if (tasks.length === 0) {
        console.log('[MCP Update Task] No tasks found or access denied')
        outcome = 'not_found'
        if (dryRun) {
            return NextResponse.json(
                {
                    success: true,
                    dry_run: true,
                    valid: true,
                    would: {
                        task_ids: [],
                        request: normalizedRequestBody
                    }
                },
                { status: 200 }
            )
        }
        return NextResponse.json(
            {
                success: false,
                tasks: [],
                error: 'Task not found or access denied'
            },
            { status: 404 }
        )
    }

    if (
        hasActiveTaskOnlyMutation(requestBody) &&
        tasks.some((task) => task.status === 'Archive')
    ) {
        console.log(
            '[MCP Update Task] Archived tasks cannot move sections or change assignees'
        )
        outcome = 'error'
        return NextResponse.json(
            {
                success: false,
                error: 'Archived tasks cannot move sections or change assignees. Unarchive them first.'
            },
            { status: 409 }
        )
    }

    if (
        hasActiveTaskOnlyMutation(requestBody) &&
        tasks.some((task) => !isActiveTaskMutationTarget(task.status))
    ) {
        console.log(
            '[MCP Update Task] Deleted tasks cannot move sections or change assignees'
        )
        outcome = 'not_found'
        return NextResponse.json(
            {
                success: false,
                error: 'Task not found or access denied'
            },
            { status: 404 }
        )
    }

    console.log('[MCP Update Task] Found tasks:', tasks.map(t => t.id))

    // Get user object for cookie (include photoURL for activity log avatars)
    const userObj = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
            id: true,
            email: true,
            displayName: true,
            photoURL: true
        }
    })

    if (!userObj) {
        return NextResponse.json(
            {
                ...buildFieldError('not_found', 'user_id', 'User not found'),
                ...(dryRun && { valid: false })
            },
            { status: 404 }
        )
    }

    // Prepare base URL and cookie for API calls
    const baseUrl = process.env.NEXT_PUBLIC_BASEURL 
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    
    const userCookie = JSON.stringify(slimUserForCookie({
        id: userObj.id,
        email: userObj.email,
        displayName: userObj.displayName,
        photoURL: userObj.photoURL ?? undefined
    }));
    // HTPR-6376: stamp the authenticated MCP agent on the internal session so
    // legacy routes like (un)archive can attribute the actor without trusting
    // a forgeable JSON body field alone.
    const sessionToken = signSession({
        id: userObj.id,
        email: userObj.email,
        ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    });
    const authCookieHeader = `nookies_user=${encodeURIComponent(userCookie)}; ${SESSION_COOKIE}=${sessionToken}`;

    // Handle priority/estimate constants
    const priorityConstant = priorityIndex !== undefined
        ? PriorityConstants.find(x => x.priority_index === priorityIndex)
        : null
    
    const estimateConstant = requestBody.estimate !== undefined
        ? EstimateConstants.find(x => x.estimate_index === requestBody.estimate)
        : null

    // Handle section update if provided (for moveTask - same board only)
    let sectionInfo: { section_title: string; projectId: number } | undefined
    if (requestBody.sectionId) {
        const newSection = await prisma.section.findUnique({
            where: { id: requestBody.sectionId },
            select: { section_title: true, projectId: true }
        })
        if (newSection) {
            sectionInfo = { section_title: newSection.section_title, projectId: newSection.projectId }
        }
    }

    if (dryRun) {
        return NextResponse.json(
            {
                success: true,
                dry_run: true,
                valid: true,
                would: {
                    task_ids: tasks.map((task) => task.id),
                    request: normalizedRequestBody
                }
            },
            { status: 200 }
        )
    }

    const persistTaskUpdates = (): Promise<UpdateTaskResponse> => persistUpdates({
        ...fields,
        request, ctx, user, requestBody, userObj, baseUrl, authCookieHeader,
        sectionInfo, priorityConstant, estimateConstant, assignAssignees,
        clearAssignees, linkPullRequest, strictSideEffectFailures,
    }, tasks);

    try {
        const mcpResponse = persist
            ? await persist(persistTaskUpdates)
            : await persistTaskUpdates()

        return NextResponse.json(mcpResponse, { status: 200 })
    } catch (error) {
        if (error instanceof UpdateTaskPersistenceError) {
            return NextResponse.json(error.response, { status: error.status })
        }
        throw error
    }
    })()

    if (outcome === 'success' && response.status >= 400) {
        outcome = 'error'
    }

    return { response, outcome }
}
