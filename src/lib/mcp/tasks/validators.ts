import { NextResponse } from 'next/server';
import { EstimateConstants, PriorityConstants } from '@/lib/constants/constants';
import { buildFieldError } from '@/lib/mcp/fieldError';
import { normalizeBlockHtml } from '@/lib/mcp/normalizeBlockHtml';
import { formatRichTextInput } from '@/utils/helperFunctions/markdownToHtml';
import { CreateTaskBody } from './types';

export const PRIORITY_ALLOWED_VALUES = PriorityConstants.map(
    (priority) => priority.priority_index
);
export const ESTIMATE_ALLOWED_VALUES = EstimateConstants.map(
    (estimate) => estimate.estimate_index
);
export const CONTENT_TYPE_ALLOWED_VALUES = ['html', 'markdown'] as const;

const PRIORITY_VALIDATION_MESSAGE = 'priority must be a number between 0 and 4 or one of: no priority, none, urgent, high, medium, low';

function normalizePriorityLabel(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const PRIORITY_LABEL_TO_INDEX = new Map<string, number>(
    PriorityConstants.map((priority) => [
        normalizePriorityLabel(priority.Priority_Value),
        priority.priority_index
    ])
);
PRIORITY_LABEL_TO_INDEX.set('none', 0);

export function parsePriorityIndex(value: unknown): { ok: true; value: number } | { ok: false; message: string } {
    if (typeof value === 'number') {
        if (Number.isInteger(value) && value >= 0 && value <= 4) {
            return { ok: true, value };
        }

        return { ok: false, message: PRIORITY_VALIDATION_MESSAGE };
    }

    if (typeof value === 'string') {
        const priorityIndex = PRIORITY_LABEL_TO_INDEX.get(normalizePriorityLabel(value));
        if (priorityIndex !== undefined) {
            return { ok: true, value: priorityIndex };
        }
    }

    return { ok: false, message: PRIORITY_VALIDATION_MESSAGE };
}

export function validateCreateTaskBody(
    body: any,
    correlationId: string | null,
    dryRun = false
): { valid: true; data: CreateTaskBody } | { valid: false; response: NextResponse } {
    // Validate project_id
    if (!body.project_id || typeof body.project_id !== 'number' || body.project_id <= 0) {
        return {
            valid: false,
            response: NextResponse.json(
                {
                    ...buildFieldError(
                        body.project_id === undefined || body.project_id === null
                            ? 'missing_field'
                            : 'invalid_field',
                        'project_id',
                        'Validation error'
                    ),
                    message: 'project_id must be a positive integer',
                    details: { field: 'project_id', code: 'invalid_type' },
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: 400 }
            )
        };
    }

    // Validate parent_task_id
    if (body.parent_task_id !== undefined && (typeof body.parent_task_id !== 'number' || body.parent_task_id <= 0)) {
        return {
            valid: false,
            response: NextResponse.json(
                {
                    ...buildFieldError('invalid_field', 'parent_task_id', 'Validation error'),
                    message: 'parent_task_id must be a positive integer',
                    details: { field: 'parent_task_id', code: 'invalid_type' },
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: 400 }
            )
        };
    }

    // Validate title
    if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
        return {
            valid: false,
            response: NextResponse.json(
                {
                    ...buildFieldError('missing_field', 'title', 'Validation error'),
                    message: 'title is required and must be a non-empty string',
                    details: { field: 'title', code: 'missing_field' },
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: 400 }
            )
        };
    }

    if (body.title.length > 500) {
        return {
            valid: false,
            response: NextResponse.json(
                {
                    ...buildFieldError('invalid_field', 'title', 'Validation error'),
                    message: 'title must not exceed 500 characters',
                    details: { field: 'title', code: 'max_length_exceeded' },
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: 400 }
            )
        };
    }

    // Validate section_id
    if (body.section_id !== undefined && (typeof body.section_id !== 'number' || body.section_id <= 0)) {
        return {
            valid: false,
            response: NextResponse.json(
                {
                    ...buildFieldError('invalid_field', 'section_id', 'Validation error'),
                    message: 'section_id must be a positive integer',
                    details: { field: 'section_id', code: 'invalid_type' },
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: 400 }
            )
        };
    }


    // Validate assignee (optional array of positive integer user IDs, e.g. [12, 34])
    let assignee_ids: number[] = [];
    if (body.assignee !== undefined && body.assignee !== null) {
        if (!Array.isArray(body.assignee)) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError('invalid_field', 'assignee', 'Validation error'),
                        message: 'assignee must be an array of positive user IDs (e.g. [1, 2, 3])',
                        details: { field: 'assignee', code: 'invalid_type' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }
        const isValid = body.assignee.every(
            (id: unknown) => Number.isInteger(id) && (id as number) > 0
        );
        if (!isValid) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError('invalid_field', 'assignee', 'Validation error'),
                        message: 'assignee must contain only positive integers',
                        details: { field: 'assignee', code: 'invalid_element' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }
        assignee_ids = body.assignee as number[];
    }


    // Validate priority
    let priority = 0;
    if (body.priority !== undefined) {
        const parsedPriority = parsePriorityIndex(body.priority);
        if (!parsedPriority.ok) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError(
                            'invalid_field',
                            'priority',
                            'Validation error',
                            PRIORITY_ALLOWED_VALUES
                        ),
                        message: parsedPriority.message,
                        details: { field: 'priority', code: 'invalid_range' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }

        priority = parsedPriority.value;
    }

    // Validate estimate
    if (body.estimate !== undefined) {
        if (typeof body.estimate !== 'number' || body.estimate < 0 || body.estimate > 7) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError(
                            'invalid_field',
                            'estimate',
                            'Validation error',
                            ESTIMATE_ALLOWED_VALUES
                        ),
                        message: 'estimate must be a number between 0 and 7',
                        details: { field: 'estimate', code: 'invalid_range' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }

        if (body.estimate > 0) {
            const estimateConstant = EstimateConstants.find(e => e.estimate_index === body.estimate);
            if (!estimateConstant) {
                return {
                    valid: false,
                    response: NextResponse.json(
                        {
                            ...buildFieldError(
                                'invalid_field',
                                'estimate',
                                'Validation error',
                                ESTIMATE_ALLOWED_VALUES
                            ),
                            message: `estimate index ${body.estimate} is not supported. Supported indices: 0 (None), 2 (XS), 3 (S), 4 (M), 5 (L), 6 (XL)`,
                            details: { field: 'estimate', code: 'unsupported_value' },
                            ...(dryRun && { valid: false }),
                            ...(correlationId && { correlationId })
                        },
                        { status: 400 }
                    )
                };
            }
        }
    }

    // Validate due_date (optional ISO 8601 date or datetime)
    if (body.due_date !== undefined && body.due_date !== null) {
        if (typeof body.due_date !== 'string' || body.due_date.trim().length === 0) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError('invalid_field', 'due_date', 'Validation error'),
                        message: 'due_date must be a non-empty ISO 8601 date or datetime string',
                        details: { field: 'due_date', code: 'invalid_type' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }
        const parsedDate = new Date(body.due_date.trim());
        if (isNaN(parsedDate.getTime())) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError('invalid_field', 'due_date', 'Validation error'),
                        message: 'due_date must be a valid ISO 8601 date or datetime (e.g. "2026-03-10" or "2026-03-10T00:00:00Z")',
                        details: { field: 'due_date', code: 'invalid_date' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }
    }

    // Validate labels (optional array of label IDs)
    if (body.labels !== undefined) {
        if (!Array.isArray(body.labels)) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError('invalid_field', 'labels', 'Validation error'),
                        message: 'labels must be an array of label IDs (strings or numbers)',
                        details: { field: 'labels', code: 'invalid_type' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }
        const invalidLabel = body.labels.find(
            (l: unknown) => typeof l !== 'string' && typeof l !== 'number'
        );
        if (invalidLabel !== undefined) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError('invalid_field', 'labels', 'Validation error'),
                        message: 'labels must contain only label IDs (strings or numbers)',
                        details: { field: 'labels', code: 'invalid_element' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }
    }

    if (body.content_type !== undefined && body.content_type !== 'html' && body.content_type !== 'markdown') {
        return {
            valid: false,
            response: NextResponse.json(
                {
                    ...buildFieldError(
                        'invalid_field',
                        'content_type',
                        'Validation error',
                        CONTENT_TYPE_ALLOWED_VALUES
                    ),
                    message: 'content_type must be one of: html, markdown',
                    details: { field: 'content_type', code: 'invalid_value' },
                    ...(dryRun && { valid: false }),
                    ...(correlationId && { correlationId })
                },
                { status: 400 }
            )
        };
    }

    // Validate images (optional array of S3 URLs)
    if (body.images !== undefined) {
        if (!Array.isArray(body.images)) {
            return {
                valid: false,
                response: NextResponse.json(
                    {
                        ...buildFieldError('invalid_field', 'images', 'Validation error'),
                        message: 'images must be an array of strings',
                        details: { field: 'images', code: 'invalid_type' },
                        ...(dryRun && { valid: false }),
                        ...(correlationId && { correlationId })
                    },
                    { status: 400 }
                )
            };
        }

        // Validate each image URL is a string and looks like a URL
        for (let i = 0; i < body.images.length; i++) {
            const imageUrl = body.images[i];
            if (typeof imageUrl !== 'string' || imageUrl.trim().length === 0) {
                return {
                    valid: false,
                    response: NextResponse.json(
                        {
                            ...buildFieldError('invalid_field', `images[${i}]`, 'Validation error'),
                            message: `images[${i}] must be a non-empty string URL`,
                            details: { field: `images[${i}]`, code: 'invalid_type' },
                            ...(dryRun && { valid: false }),
                            ...(correlationId && { correlationId })
                        },
                        { status: 400 }
                    )
                };
            }

            // Basic URL validation (should start with http:// or https://)
            if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
                return {
                    valid: false,
                    response: NextResponse.json(
                        {
                            ...buildFieldError('invalid_field', `images[${i}]`, 'Validation error'),
                            message: `images[${i}] must be a valid HTTP/HTTPS URL`,
                            details: { field: `images[${i}]`, code: 'invalid_url' },
                            ...(dryRun && { valid: false }),
                            ...(correlationId && { correlationId })
                        },
                        { status: 400 }
                    )
                };
            }
        }
    }

    return {
        valid: true,
        data: {
            project_id: body.project_id,
            title: body.title.trim(),
            description: normalizeBlockHtml(
                formatRichTextInput(body.description || '', body.content_type)
            ),
            section_id: body.section_id,
            priority,
            estimate: body.estimate !== undefined ? body.estimate : 0,
            due_date: body.due_date?.trim() || undefined,
            images: body.images || [],
            labels: body.labels || [],
            parent_task_id: body.parent_task_id || undefined,
            assignee_ids
        }
    };
}

/** Parse MCP `assignee` CSV into user ids (matches create-task validation). */
export function parseAssigneeIds(raw: string): { ok: true; ids: number[] } | { ok: false; message: string } {
    const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    const ids: number[] = [];
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!/^\d+$/.test(p)) {
            return {
                ok: false,
                message: `assignee: invalid user id at segment ${i + 1}; use comma-separated positive integers (e.g. "1,2,3")`,
            };
        }
        const n = parseInt(p, 10);
        if (n <= 0) {
            return { ok: false, message: "assignee: user ids must be positive integers" };
        }
        ids.push(n);
    }
    return { ok: true, ids: [...new Set(ids)] };
}
