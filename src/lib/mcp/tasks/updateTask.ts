import { EstimateConstants, PriorityConstants } from "@/lib/constants/constants";
import type { McpAuthContext } from "@/lib/mcp/auth";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { McpAgentSummary } from "@/lib/mcp/agents";
import { getMcpSessionAgentSummary } from "@/lib/mcp/agents";
import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { mapTaskToDetail, taskDetailInclude } from "@/lib/mcp/tasks/mappers";
import { mutateTaskLabels, setTaskLabels } from "@/lib/mcp/tasks/services";
import { TaskDetail } from "@/lib/mcp/tasks/types";
import {
    CONTENT_TYPE_ALLOWED_VALUES,
    ESTIMATE_ALLOWED_VALUES,
    PRIORITY_ALLOWED_VALUES,
    parseAssigneeIds,
    parsePriorityIndex,
} from "@/lib/mcp/tasks/validators";
import { persistUrlsForDescription } from "@/utils/controllers/urls/extractUrlsFromContent";
import { broadcastTaskUpdates } from "@/lib/mcp/tasks/broadcastTaskUpdates";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import { normalizeBlockHtml } from "@/lib/mcp/normalizeBlockHtml";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { markdownToHtml } from "@/utils/helperFunctions/markdownToHtml";
import { buildFieldError } from "@/lib/mcp/fieldError";
import { requireRole } from "@/lib/mcp/agents/scopes";
import { assertAgentAssignmentChangeAllowed } from "@/lib/mcp/tasks/agentMutationFence";
import {
    parseContractFieldsInput,
    type ContractFieldUpdates,
} from "@/lib/mcp/tasks/contractFields";
import { hasSingleTaskUpdate } from "@/lib/mcp/tasks/updateFields";
import { clearHumanAssignees } from "@/utils/controllers/assignees/assign";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import {
    hasActiveTaskOnlyMutation,
    isActiveTaskMutationTarget,
} from "@/lib/mcp/tasks/activeTaskMutation";
import { toErrorMessage } from "@/lib/api/errorMessage";
import { parseGithubPullRequestUrl } from "@/lib/pullRequests/githubPullRequests";
import { linkTaskPullRequest } from "@/lib/pullRequests/taskPullRequests";

export interface UpdateTaskResponse {
    success: boolean;
    tasks: TaskDetail[];
    idempotent_replayed?: true;
    task?: TaskDetail; // Backward compatibility - included when updating a single task
    /** MCP session agent that performed this action */
    agent?: McpAgentSummary;
    message?: string;
}

interface UpdateTaskErrorResponse {
    success: false;
    tasks: TaskDetail[];
    error: string;
}

class UpdateTaskPersistenceError extends Error {
    constructor(readonly response: UpdateTaskErrorResponse) {
        super(response.error)
        this.name = 'UpdateTaskPersistenceError'
    }
}

const VALID_STATUSES = ['Normal', 'Archive', 'Deleted'] as const;

export interface UpdateTaskBody {
    dry_run?: boolean;
    task_id?: number | number[];
    project_id?: number;
    ticket_number?: string | string[];
    unique_index?: number;
    priority?: number | string;
    estimate?: number;
    description?: string;
    content_type?: 'html' | 'markdown';
    title?: string;
    sectionId?: number;
    status?: typeof VALID_STATUSES[number];
    labels?: (string | number)[];
    add_labels?: (string | number)[];
    remove_labels?: (string | number)[];
    due_date?: string | null; // ISO 8601 date or datetime; null to clear
    assignee?: number[];
    parent_task_id?: number | null;
    risk_level?: string;
    acceptance_criteria?: string;
    verify_command?: string;
    pull_request_url?: string;
}

export interface TaskUpdateExecutionResult {
    response: NextResponse;
    outcome: 'success' | 'not_found' | 'error';
}

export type TaskUpdateAssigneeHandler = (input: {
    taskId: number;
    projectId: number;
    userIds: number[];
    intent: 'assign' | 'unassign';
    user: {
        id: number;
        email: string;
        displayName: string | null;
        photoURL: string | null;
    };
    agentId: string | null;
}) => Promise<void>;

export type TaskClearAssigneesHandler = (input: {
    taskId: number;
    user: {
        id: number;
        email: string;
        displayName: string | null;
        photoURL: string | null;
    };
    agentId: string | null;
}) => Promise<void>;

interface ExecuteTaskUpdateOptions {
    request: NextRequest;
    ctx: McpAuthContext;
    requestBody: UpdateTaskBody;
    dryRun?: boolean;
    assignAssignees?: TaskUpdateAssigneeHandler;
    clearAssignees?: TaskClearAssigneesHandler;
    linkPullRequest?: typeof linkTaskPullRequest;
    strictSideEffectFailures?: boolean;
    persist?: (
        persistTaskUpdates: () => Promise<UpdateTaskResponse>
    ) => Promise<UpdateTaskResponse>;
}

// Helper function to find tasks by different identification methods
async function findTasksByIdentifier(
    user: { id: number },
    options: {
        task_id?: number | number[] | null
        ticket_number?: string | string[] | null
        unique_index?: number | null
        project_id?: number | null
    },
    agentId?: string | null
) {
    const { task_id, ticket_number, unique_index, project_id } = options

    const orConditions: any[] = []

    if (task_id) {
        const taskIds = Array.isArray(task_id) ? task_id : [task_id]
        const validTaskIds = taskIds.filter(id => id && !isNaN(Number(id))).map(id => Number(id))
        if (validTaskIds.length > 0) {
            orConditions.push({ id: { in: validTaskIds } })
        }
    }

    if (ticket_number) {
        const ticketNumbers = Array.isArray(ticket_number) ? ticket_number : [ticket_number]
        const validTicketNumbers = ticketNumbers.filter(t => t && typeof t === 'string' && t.length > 0)
        if (validTicketNumbers.length > 0) {
            const ticketCondition: any = { ticketNumber: { in: validTicketNumbers } }
            if (project_id) {
                ticketCondition.projectId = project_id
            }
            orConditions.push(ticketCondition)
        }
    }

    if (unique_index !== null && unique_index !== undefined && project_id !== null && project_id !== undefined) {
        orConditions.push({
            projectId: project_id,
            uniqueIndex: unique_index,
            status: { not: 'Deleted' }
        })
    }

    if (orConditions.length === 0) {
        return []
    }

    // Resolve tasks the same way move/get do (see resolveTask.ts): explicit
    // task_id / ticket_number lookups must reach Deleted-status tasks too, so a
    // soft-deleted ticket can still be archived/restored. Only the unique_index
    // arm excludes Deleted (its own condition above). Without this, a Deleted
    // task resolved to no rows, the response omitted `task`, and the CLI/MCP
    // null-deref'd on `.ticketNumber` (HTPR-3801).
    const tasks = await prisma.task.findMany({
        where: {
            OR: orConditions,
            project: getProjectWhere(user.id, agentId)
        },
        select: { id: true, sectionId: true, projectId: true, status: true }
    })

    return tasks
}

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

    if (requestBody.content_type !== undefined && requestBody.content_type !== 'html' && requestBody.content_type !== 'markdown') {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'invalid_field',
                    'content_type',
                    'Invalid content_type. Must be one of: html, markdown',
                    CONTENT_TYPE_ALLOWED_VALUES
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    let assigneeUserIds: number[] | undefined;
    if (requestBody.assignee !== undefined) {
        if (!Array.isArray(requestBody.assignee)) {
            return NextResponse.json(
                {
                    ...buildFieldError(
                        'invalid_field',
                        'assignee',
                        'assignee must be an array of positive integers (e.g. [1,2,3])'
                    ),
                    ...(dryRun && { valid: false })
                },
                { status: 400 }
            );
        }
        const parsed = parseAssigneeIds(requestBody.assignee.join(','));
        if (!parsed.ok) {
            return NextResponse.json(
                {
                    ...buildFieldError('invalid_field', 'assignee', parsed.message),
                    ...(dryRun && { valid: false })
                },
                { status: 400 }
            );
        }
        assigneeUserIds = parsed.ids;
    }
    
    // Validate that at least one field to update is provided
    const hasLabels = requestBody.labels !== undefined && Array.isArray(requestBody.labels);
    const hasLabelMutation =
        Array.isArray(requestBody.add_labels) || Array.isArray(requestBody.remove_labels);
    const hasDueDate = requestBody.due_date !== undefined;
    const hasAssigneeField = requestBody.assignee !== undefined;
    const hasDescriptionUpdate = requestBody.description !== undefined;
    const hasTextOrParentUpdate = hasSingleTaskUpdate(requestBody);
    const hasPullRequestUpdate = requestBody.pull_request_url !== undefined;
    const hasContractFieldUpdate =
        requestBody.risk_level !== undefined ||
        requestBody.acceptance_criteria !== undefined ||
        requestBody.verify_command !== undefined;
    let contractFieldUpdates: ContractFieldUpdates = {};
    if (hasContractFieldUpdate) {
        const parsedContractFields = parseContractFieldsInput({
            risk_level: requestBody.risk_level,
            acceptance_criteria: requestBody.acceptance_criteria,
            verify_command: requestBody.verify_command,
        });
        if (!parsedContractFields.ok) {
            return NextResponse.json(
                {
                    ...buildFieldError(
                        'invalid_field',
                        parsedContractFields.field,
                        parsedContractFields.error
                    ),
                    ...(dryRun && { valid: false })
                },
                { status: 400 }
            );
        }
        contractFieldUpdates = parsedContractFields.value;
    }
    if (!hasTextOrParentUpdate && requestBody.estimate === undefined && requestBody.priority === undefined && !requestBody.sectionId && !requestBody.status && !hasLabels && !hasLabelMutation && !hasDueDate && !hasAssigneeField && !hasContractFieldUpdate && !hasPullRequestUpdate) {
        console.log('[MCP Update Task] Validation failed: No fields to update')
        return NextResponse.json(
            {
                ...buildFieldError(
                    'missing_field',
                    'update',
                    "Please make sure the request body contains at least one field to update"
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    if (requestBody.title !== undefined && (typeof requestBody.title !== 'string' || requestBody.title.trim().length === 0)) {
        return NextResponse.json(
            {
                ...buildFieldError('invalid_field', 'title', 'title must be a non-empty string'),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }
    if (hasDescriptionUpdate && typeof requestBody.description !== 'string') {
        return NextResponse.json(
            {
                ...buildFieldError('invalid_field', 'description', 'description must be a string'),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    const parsedPullRequest = hasPullRequestUpdate
        ? parseGithubPullRequestUrl(requestBody.pull_request_url)
        : null;
    if (hasPullRequestUpdate && !parsedPullRequest) {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'invalid_field',
                    'pull_request_url',
                    'Use a full GitHub pull request URL'
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    if (requestBody.description) {
        requestBody.description = normalizeBlockHtml(
            requestBody.content_type === 'markdown'
                ? markdownToHtml(requestBody.description)
                : requestBody.description
        )
    }

    // Validate labels if provided
    if (hasLabels) {
        const invalidLabel = requestBody.labels!.find(
            (l: unknown) => typeof l !== 'string' && typeof l !== 'number'
        );
        if (invalidLabel !== undefined) {
            return NextResponse.json(
                {
                    ...buildFieldError(
                        'invalid_field',
                        'labels',
                        "labels must be an array of label IDs (strings or numbers)"
                    ),
                    ...(dryRun && { valid: false })
                },
                { status: 400 }
            );
        }
    }

    // Validate due_date if provided (must be valid ISO 8601 or null to clear)
    if (hasDueDate && requestBody.due_date !== null) {
        if (typeof requestBody.due_date !== 'string' || requestBody.due_date.trim().length === 0) {
            return NextResponse.json(
                {
                    ...buildFieldError(
                        'invalid_field',
                        'due_date',
                        'due_date must be a non-empty ISO 8601 date/datetime string, or null to clear'
                    ),
                    ...(dryRun && { valid: false })
                },
                { status: 400 }
            );
        }
        const parsedDate = new Date(requestBody.due_date.trim());
        if (isNaN(parsedDate.getTime())) {
            return NextResponse.json(
                {
                    ...buildFieldError(
                        'invalid_field',
                        'due_date',
                        'due_date must be a valid ISO 8601 date or datetime (e.g. "2026-03-10" or "2026-03-10T00:00:00Z")'
                    ),
                    ...(dryRun && { valid: false })
                },
                { status: 400 }
            );
        }
    }

    // Validate status if provided
    if (requestBody.status !== undefined && !VALID_STATUSES.includes(requestBody.status)) {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'invalid_field',
                    'status',
                    `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
                    VALID_STATUSES
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    let priorityIndex: number | undefined;
    if (requestBody.priority !== undefined) {
        const parsedPriority = parsePriorityIndex(requestBody.priority);
        if (!parsedPriority.ok) {
            return NextResponse.json(
                {
                    ...buildFieldError(
                        'invalid_field',
                        'priority',
                        'Validation error',
                        PRIORITY_ALLOWED_VALUES
                    ),
                    message: parsedPriority.message,
                    details: { field: 'priority', code: 'invalid_range' },
                    ...(dryRun && { valid: false })
                },
                { status: 400 }
            );
        }
        priorityIndex = parsedPriority.value;
    }

    if (
        requestBody.estimate !== undefined &&
        !ESTIMATE_ALLOWED_VALUES.includes(requestBody.estimate)
    ) {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'invalid_field',
                    'estimate',
                    `Invalid estimate. Must be one of: ${ESTIMATE_ALLOWED_VALUES.join(', ')}`,
                    ESTIMATE_ALLOWED_VALUES
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    // Validate task identifiers
    const { task_id, ticket_number, unique_index, project_id } = requestBody
    const methodCount = [!!task_id, !!ticket_number, !!unique_index].filter(Boolean).length

    if (methodCount === 0) {
        console.log('[MCP Update Task] Validation failed: Missing task identifier')
        return NextResponse.json(
            {
                ...buildFieldError(
                    'missing_field',
                    'task_id/ticket_number',
                    "Either task_id, ticket_number, or (project_id + unique_index) must be provided"
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    if (methodCount > 1) {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'invalid_field',
                    'task_id/ticket_number',
                    'Cannot provide multiple identification methods. Use either task_id, ticket_number, or (project_id + unique_index)'
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    if (unique_index !== null && unique_index !== undefined && !project_id) {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'missing_field',
                    'project_id',
                    'project_id is required when using unique_index'
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    // Validate arrays are not empty
    if (task_id && Array.isArray(task_id) && task_id.length === 0) {
        return NextResponse.json(
            {
                ...buildFieldError('missing_field', 'task_id', 'task_id array cannot be empty'),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    if (ticket_number && Array.isArray(ticket_number) && ticket_number.length === 0) {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'missing_field',
                    'ticket_number',
                    'ticket_number array cannot be empty'
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }

    // Validate ticket_number format if provided
    if (ticket_number) {
        const ticketNumbers = Array.isArray(ticket_number) ? ticket_number : [ticket_number]
        for (const tn of ticketNumbers) {
            if (!/^[a-zA-Z0-9_-]+$/.test(tn)) {
                return NextResponse.json(
                    {
                        ...buildFieldError(
                            'invalid_field',
                            'ticket_number',
                            `Invalid ticket_number format: ${tn}`
                        ),
                        ...(dryRun && { valid: false })
                    },
                    { status: 400 }
                )
            }
        }
    }

    const normalizedRequestBody = { ...requestBody }
    delete normalizedRequestBody.dry_run
    if (priorityIndex !== undefined) {
        normalizedRequestBody.priority = priorityIndex
    }
    if (parsedPullRequest) {
        normalizedRequestBody.pull_request_url = parsedPullRequest.url
    }

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
        tasks.some((task) => !isActiveTaskMutationTarget(task.status))
    ) {
        console.log(
            '[MCP Update Task] Archived or deleted tasks cannot move sections or change assignees'
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
    const sessionToken = signSession({ id: userObj.id, email: userObj.email });
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

    const persistTaskUpdates = async (): Promise<UpdateTaskResponse> => {
    // Update all tasks in parallel
    const updatePromises = tasks.map(async (task) => {
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

            const fetchOpts = {
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': authCookieHeader
                }
            }

            // 1. Section change (same board): use moveTask for activity + notifications
            if (requestBody.sectionId && sectionInfo && sectionInfo.projectId === task.projectId) {
                const moveTaskUrl = `${baseUrl}/api/tasks/moveTask`
                const moveResponse = await fetch(moveTaskUrl, {
                    method: 'PUT',
                    ...fetchOpts,
                    body: JSON.stringify({
                        taskId: task.id,
                        section_title: sectionInfo.section_title,
                        sectionId: requestBody.sectionId,
                        projectId: task.projectId,
                        agentId: ctx.agentId || undefined
                        // ranking omitted - moveTask computes it
                    })
                })
                if (!moveResponse.ok) {
                    const errorData = await moveResponse.json().catch(() => ({ message: 'Failed to move task' }))
                    throw new Error(
                        toErrorMessage(
                            errorData,
                            `Move task failed: ${moveResponse.status}`
                        )
                    )
                }
                await moveResponse.json().catch(() => null)
            } else if (requestBody.sectionId && sectionInfo && sectionInfo.projectId !== task.projectId) {
                throw new Error('Section must belong to the same project. Use move endpoint for cross-board moves.')
            }

            // 2. Status change: use (un)archive for activity + notifications
            if (requestBody.status) {
                const archiveUrl = `${baseUrl}/api/tasks/(un)archive`
                const archiveResponse = await fetch(archiveUrl, {
                    method: 'POST',
                    ...fetchOpts,
                    body: JSON.stringify({
                        taskId: task.id,
                        status: requestBody.status,
                        agentId: ctx.agentId || undefined
                    })
                })
                if (!archiveResponse.ok) {
                    const errorData = await archiveResponse.json().catch(() => ({ message: 'Failed to update status' }))
                    throw new Error(
                        toErrorMessage(
                            errorData,
                            `Archive/status update failed: ${archiveResponse.status}`
                        )
                    )
                }
                await archiveResponse.json().catch(() => null)
            }

            // 3. Other fields (title, description, due_date): use single endpoint
            const dueDateValue = hasDueDate
                ? (requestBody.due_date === null ? null : new Date(requestBody.due_date!.trim()))
                : undefined
            if (hasTextOrParentUpdate) {
                const newTask: any = { id: task.id }
                if (requestBody.title !== undefined) newTask.title = requestBody.title
                // SECURITY: Sanitize MCP rich text before the legacy updater, and preserve explicit parent_task_id null clears from staging.
                const sanitizedDescription = hasDescriptionUpdate
                    ? sanitizeRichHtml(requestBody.description ?? '')
                    : undefined
                if (sanitizedDescription !== undefined) newTask.description = sanitizedDescription
                if (requestBody.parent_task_id !== undefined) newTask.parentTaskId = requestBody.parent_task_id

                const singleUrl = `${baseUrl}/api/tasks/single`
                const singleResponse = await fetch(singleUrl, {
                    method: 'PUT',
                    ...fetchOpts,
                    body: JSON.stringify({
                        newTask,
                        agentId: ctx.agentId || undefined,
                    })
                })
                if (!singleResponse.ok) {
                    const errorData = await singleResponse.json().catch(() => ({ message: 'Failed to update task' }))
                    throw new Error(
                        toErrorMessage(
                            errorData,
                            `Task update failed: ${singleResponse.status}`
                        )
                    )
                }
                await singleResponse.json().catch(() => null)

                if (sanitizedDescription) {
                    await persistUrlsForDescription(sanitizedDescription, task.id)
                }
            }

            if (hasDueDate) {
                const setDueDateUrl = `${baseUrl}/api/tasks/setDueDate`
                const dueDateResponse = await fetch(setDueDateUrl, {
                    method: 'POST',
                    ...fetchOpts,
                    body: JSON.stringify({
                        taskId: task.id,
                        dueDate: dueDateValue ?? null,
                        agentId: ctx.agentId || undefined,
                    }),
                })
                if (!dueDateResponse.ok) {
                    const errorData = await dueDateResponse.json().catch(() => ({ message: 'Failed to set due date' }))
                    throw new Error(
                        toErrorMessage(
                            errorData,
                            `Due date update failed: ${dueDateResponse.status}`
                        )
                    )
                }
                await dueDateResponse.json().catch(() => null)
            }

            // Handle priority/estimate updates using their dedicated APIs
            if (priorityConstant) {
                const priorityApiUrl = `${baseUrl}/api/priority/setPriority`
                const priorityResponse = await fetch(priorityApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': authCookieHeader
                    },
                    body: JSON.stringify({
                        taskId: task.id,
                        priority_index: priorityConstant.priority_index,
                        Priority_Value: priorityConstant.Priority_Value,
                        agentId: ctx.agentId || undefined
                    })
                })
                
                if (!priorityResponse.ok) {
                    console.warn(`[MCP Update Task] Failed to update priority for task ${task.id}`)
                    if (strictSideEffectFailures) {
                        throw new Error(
                            `Priority update failed: ${priorityResponse.status}`
                        )
                    }
                }
            }

            if (estimateConstant) {
                const estimateApiUrl = `${baseUrl}/api/estimate/setEstimate`
                const estimateResponse = await fetch(estimateApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': authCookieHeader
                    },
                    body: JSON.stringify({
                        taskId: task.id,
                        estimate_index: estimateConstant.estimate_index,
                        estimate_value: estimateConstant.estimate_value,
                        agentId: ctx.agentId || undefined
                    })
                })
                
                if (!estimateResponse.ok) {
                    console.warn(`[MCP Update Task] Failed to update estimate for task ${task.id}`)
                    if (strictSideEffectFailures) {
                        throw new Error(
                            `Estimate update failed: ${estimateResponse.status}`
                        )
                    }
                }
            }

            // Handle labels (replace all)
            if (hasLabels) {
                try {
                    await setTaskLabels(
                        task.id,
                        task.projectId,
                        requestBody.labels!,
                        userObj
                    );
                } catch (labelError) {
                    console.warn(`[MCP Update Task] Failed to update labels for task ${task.id}:`, labelError);
                    throw labelError;
                }
            }

            // Handle additive/subtractive label changes (leaves other labels intact)
            if (hasLabelMutation) {
                try {
                    await mutateTaskLabels(
                        task.id,
                        task.projectId,
                        { add: requestBody.add_labels, remove: requestBody.remove_labels },
                        userObj
                    );
                } catch (labelError) {
                    console.warn(`[MCP Update Task] Failed to mutate labels for task ${task.id}:`, labelError);
                    throw labelError;
                }
            }

            if (hasContractFieldUpdate) {
                try {
                    await prisma.task.update({
                        where: { id: task.id },
                        data: { ...contractFieldUpdates },
                    });
                } catch (contractFieldError) {
                    console.warn(`[MCP Update Task] Failed to update contract fields for task ${task.id}:`, contractFieldError);
                    throw contractFieldError;
                }
            }

            if (parsedPullRequest) {
                await linkPullRequest({
                    taskId: task.id,
                    userId: user.id,
                    agentId: ctx.agentId,
                    url: parsedPullRequest.url,
                });
            }

            // Assignees via MCP route (validates project membership for all user ids)
            if (assigneeUserIds !== undefined) {
                if (assigneeUserIds.length === 0) {
                    if (clearAssignees) {
                        await clearAssignees({
                            taskId: task.id,
                            user: userObj,
                            agentId: ctx.agentId,
                        });
                    } else {
                        const clearResult = await clearHumanAssignees(
                            userObj,
                            task.id,
                            ctx.agentId ?? undefined
                        );
                        if (clearResult.status !== 200) {
                            throw new Error(
                                (clearResult.json as { message?: string }).message ??
                                    'Failed to clear assignees'
                            );
                        }
                    }
                    return { success: true, taskId: task.id };
                }

                const updateAssignees = async (
                    userIds: number[],
                    intent: 'assign' | 'unassign'
                ) => {
                    if (userIds.length === 0) return;

                    try {
                        if (assignAssignees) {
                            await assignAssignees({
                                taskId: task.id,
                                projectId: task.projectId,
                                userIds,
                                intent,
                                user: userObj,
                                agentId: ctx.agentId,
                            });
                            return;
                        }

                        const mcpAuthorization = request.headers.get('Authorization')
                        if (!mcpAuthorization?.startsWith('Bearer ')) {
                            throw new Error('Missing Authorization for assignee update');
                        }
                        const assignUrl = `${baseUrl}/api/mcp/assignees/assign`;
                        const assignResponse = await fetch(assignUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: mcpAuthorization,
                            },
                            body: JSON.stringify({
                                task_id: task.id,
                                user_ids: userIds,
                                mode: 'multiple',
                                intent,
                            }),
                        });
                        if (!assignResponse.ok) {
                            const errorData = await assignResponse
                                .json()
                                .catch(() => ({ error: `Failed to ${intent} users` }));
                            throw new Error(
                                (errorData as { error?: string; message?: string }).error ||
                                    (errorData as { message?: string }).message ||
                                    `${intent === 'assign' ? 'Assign' : 'Unassign'} failed: ${assignResponse.status}`
                            );
                        }
                        await assignResponse.json().catch(() => null);
                    } catch (assignErr) {
                        console.warn(
                            `[MCP Update Task] Failed to ${intent} users for task ${task.id}:`,
                            assignErr
                        );
                        if (strictSideEffectFailures) throw assignErr;
                    }
                };

                let currentHumanAssignees: { userId: number }[] | null = null;
                try {
                    currentHumanAssignees = await prisma.assignees.findMany({
                        where: { taskId: task.id, agentId: null },
                        select: { userId: true },
                    });
                } catch (assigneeReadErr) {
                    console.warn(
                        `[MCP Update Task] Failed to read assignees for task ${task.id}:`,
                        assigneeReadErr
                    );
                    if (strictSideEffectFailures) throw assigneeReadErr;
                }

                if (!currentHumanAssignees) {
                    // Could not read the current list, so reconciling would drop
                    // everyone or no one at random. Fall back to the old additive
                    // behaviour rather than silently assigning nobody.
                    await updateAssignees(assigneeUserIds, 'assign');
                } else {
                    const requestedUserIds = new Set(assigneeUserIds);
                    const currentUserIds = new Set(
                        currentHumanAssignees.map((assignee) => assignee.userId)
                    );
                    const userIdsToUnassign = [...currentUserIds].filter(
                        (userId) => !requestedUserIds.has(userId)
                    );
                    const userIdsToAssign = assigneeUserIds.filter(
                        (userId) => !currentUserIds.has(userId)
                    );

                    await updateAssignees(userIdsToUnassign, 'unassign');
                    await updateAssignees(userIdsToAssign, 'assign');
                }
            }

            return { success: true, taskId: task.id }
        } catch (error) {
            console.error(`[MCP Update Task] Error updating task ${task.id}:`, error)
            return {
                success: false,
                taskId: task.id,
                error: toErrorMessage(error, 'Unknown error'),
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
        throw new UpdateTaskPersistenceError({
            success: false,
            tasks: [],
            error: `Failed to update ${failedTasks.length} task(s). ${errorMessages.length > 0 ? errorMessages[0] : 'Unknown error'}`
        })
    }

    // Fetch complete tasks with all relations for MCP response format
    const updatedTasks = await prisma.task.findMany({
        where: { id: { in: updatedTaskIds } },
        include: taskDetailInclude
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

    const mappedTasks = updatedTasks.map(mapTaskToDetail)
    
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
        ...(sessionAgent ? { agent: sessionAgent } : {}),
    }

    return mcpResponse
    }

    try {
        const mcpResponse = persist
            ? await persist(persistTaskUpdates)
            : await persistTaskUpdates()

        return NextResponse.json(mcpResponse, { status: 200 })
    } catch (error) {
        if (error instanceof UpdateTaskPersistenceError) {
            return NextResponse.json(error.response, { status: 500 })
        }
        throw error
    }
    })()

    if (outcome === 'success' && response.status >= 400) {
        outcome = 'error'
    }

    return { response, outcome }
}
