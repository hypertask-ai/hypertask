import { NextResponse } from "next/server";
import { ESTIMATE_ALLOWED_VALUES, PRIORITY_ALLOWED_VALUES, parsePriorityIndex } from "@/lib/mcp/tasks/validators";
import { buildFieldError } from "@/lib/mcp/fieldError";
import { VALID_STATUSES, type UpdateTaskBody } from './types';
import type { validateTaskUpdateFields } from './validateFields';

export function validateTaskUpdateIdentifiers(requestBody: UpdateTaskBody, dryRun: boolean, fields: Exclude<Awaited<ReturnType<typeof validateTaskUpdateFields>>, NextResponse>) {
    const { hasDueDate, parsedPullRequest } = fields;
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
    return { priorityIndex, task_id, ticket_number, unique_index, project_id, normalizedRequestBody };
}
