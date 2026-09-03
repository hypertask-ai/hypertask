import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth';
import type { McpAgentSummary } from '@/lib/mcp/agents';
import { getMcpSessionAgentSummary } from '@/lib/mcp/agents';
import { NextRequest, NextResponse } from 'next/server';
import { validateCreateTaskBody } from '@/lib/mcp/tasks/validators';
import { validateProjectAccess, getSectionForTask, createTask, validateParentTask, validateProjectMemberIds } from '@/lib/mcp/tasks/services';
import { mapTaskToDetail } from '@/lib/mcp/tasks/mappers';
import { CreateTaskBody, TaskDetail } from '@/lib/mcp/tasks/types';
import { sanitizeRichHtml } from '@/utils/helperFunctions/sanitizeRichHtml';
import { IdempotencyInProgressError, normalizeIdempotencyKey, withIdempotency } from '@/lib/mcp/idempotency/idempotencyStore';
import { buildFieldError } from '@/lib/mcp/fieldError';
import { requireRole } from '@/lib/mcp/agents/scopes';
import { readJsonBody } from '@/lib/mcp/readJsonBody';

export interface CreateTaskResponse {
    success: boolean;
    idempotent_replayed?: true;
    task: TaskDetail;
    /** MCP session agent that performed this action */
    agent?: McpAgentSummary;
    message?: string;
}

export async function POST(request: NextRequest) {
    const correlationId = request.headers.get('X-Correlation-ID');

    try {
        // Authenticate
        const rateLimited = await checkMcpRateLimit(request);
        if (rateLimited) return rateLimited;
        const ctx = await validateMcpAuth(request);
        if (!ctx) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Authentication error',
                    message: 'Invalid or expired JWT token',
                    ...(correlationId && { correlationId })
                },
                { status: 401 }
            );
        }
        if (ctx.agentId) {
            const scopeError = await requireRole(ctx, 'write');
            if (scopeError) return scopeError;
        }
        const user = ctx.user;
        // Parse and validate request body
        const parsedBody = await readJsonBody<CreateTaskBody>(request);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.body;
        if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') {
            return NextResponse.json(
                {
                    ...buildFieldError('invalid_field', 'dry_run', 'Validation error'),
                    message: 'dry_run must be a boolean',
                    details: { field: 'dry_run', code: 'invalid_type' },
                    ...(correlationId && { correlationId })
                },
                { status: 400 }
            );
        }
        const dryRun = body.dry_run ?? false;
        const { dry_run: _dryRun, ...idempotencyBody } = body;

        let clientIdempotencyKey: string | null;
        try {
            clientIdempotencyKey = normalizeIdempotencyKey(
                request.headers.get('Idempotency-Key')
            );
        } catch (error) {
            return NextResponse.json(
                {
                    ...buildFieldError('invalid_field', 'Idempotency-Key', 'Validation error'),
                    message: error instanceof Error ? error.message : 'Invalid Idempotency-Key header',
                    details: { field: 'Idempotency-Key', code: 'invalid_length' },
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: 400 }
            );
        }

        const validation = validateCreateTaskBody(body, correlationId, dryRun);
        
        if (!validation.valid) {
            return validation.response;
        }

        const { project_id, title, description, section_id, priority, estimate, due_date, images, labels, parent_task_id, assignee_ids } = validation.data;

        // Validate project access
        const projectCheck = await validateProjectAccess(project_id, user.id, ctx.agentId);
        if (projectCheck.error) {
            return NextResponse.json(
                {
                    ...buildFieldError(
                        projectCheck.error.status === 404 ? 'not_found' : 'forbidden',
                        'project_id',
                        projectCheck.error.status === 404 ? 'Not found' : 'Permission error'
                    ),
                    message: projectCheck.error.message,
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: projectCheck.error.status }
            );
        }

        // Get section
        const sectionCheck = await getSectionForTask(project_id, section_id);
        if (sectionCheck.error) {
            return NextResponse.json(
                {
                    ...buildFieldError('not_found', 'section_id', 'Not found'),
                    message: sectionCheck.error.message,
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: sectionCheck.error.status }
            );
        }

        // Validate parent task exists (a bad client-supplied id must 404, not 500)
        const parentCheck = await validateParentTask(project_id, parent_task_id);
        if (parentCheck.error) {
            return NextResponse.json(
                {
                    ...buildFieldError('not_found', 'parent_task_id', 'Not found'),
                    message: parentCheck.error.message,
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: parentCheck.error.status }
            );
        }

        if (assignee_ids && assignee_ids.length > 0) {
            const memberCheck = await validateProjectMemberIds(project_id, assignee_ids);
            if (memberCheck.error) {
                return NextResponse.json(
                    {
                        ...buildFieldError(
                            memberCheck.error.status === 404 ? 'not_found' : 'invalid_field',
                            'assignee',
                            memberCheck.error.status === 404 ? 'Not found' : 'Validation error'
                        ),
                        message: memberCheck.error.message,
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: memberCheck.error.status }
                );
            }

            if (memberCheck.invalidIds.length > 0) {
                return NextResponse.json(
                    {
                        ...buildFieldError('invalid_field', 'assignee', 'Validation error'),
                        message: `User(s) ${memberCheck.invalidIds.join(', ')} are not members of this project and cannot be assigned.`,
                        details: { field: 'assignee_ids', code: 'not_project_member', invalidIds: memberCheck.invalidIds },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                );
            }
        }

        if (dryRun) {
            const sanitizedDescription = sanitizeRichHtml(description || '');
            return NextResponse.json(
                {
                    success: true,
                    dry_run: true,
                    valid: true,
                    would: {
                        project_id,
                        title,
                        description: sanitizedDescription,
                        section_id: sectionCheck.section.id,
                        priority: priority ?? 0,
                        estimate: estimate ?? 0,
                        due_date,
                        images: images || [],
                        labels: labels || [],
                        parent_task_id,
                        assignee_ids: assignee_ids || []
                    }
                },
                { status: 200 }
            );
        }

        const response = await withIdempotency(
            'create_task',
            user.id,
            clientIdempotencyKey,
            idempotencyBody,
            async (): Promise<CreateTaskResponse> => {
                const task = await createTask({
                    projectId: project_id,
                    title,
                    description: sanitizeRichHtml(description || ''),
                    sectionId: sectionCheck.section.id,
                    sectionTitle: sectionCheck.section.section_title,
                    userId: user.id,
                    priorityIndex: priority ?? 0,
                    estimateIndex: estimate ?? 0,
                    dueDate: due_date ? new Date(due_date) : undefined,
                    projectUniqueIdentifier: projectCheck.project.uniqueIdentifier,
                    teamId: projectCheck.project.teamId,
                    images: images || [],
                    labels: labels || [],
                    parentTaskId: parent_task_id || undefined,
                    assigneeIds: assignee_ids && assignee_ids.length > 0 ? assignee_ids : undefined,
                    agentId: ctx.agentId || undefined
                });

                const sessionAgent = await getMcpSessionAgentSummary(ctx.agentId, user.id);

                return {
                    success: true,
                    task: mapTaskToDetail(task, user.id),
                    message: 'Task created successfully',
                    ...(sessionAgent ? { agent: sessionAgent } : {}),
                };
            }
        );

        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        if (error instanceof IdempotencyInProgressError) {
            return NextResponse.json(
                { success: false, error: error.message, ...(correlationId && { correlationId }) },
                { status: 409 }
            );
        }
        console.error('[MCP Create Task] Error:', error);

        return NextResponse.json(
            {
                success: false,
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'An unexpected error occurred while creating the task',
                ...(correlationId && { correlationId })
            },
            { status: 500 }
        );
    }
}
