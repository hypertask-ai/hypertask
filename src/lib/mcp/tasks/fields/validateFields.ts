import { NextResponse } from "next/server";
import { CONTENT_TYPE_ALLOWED_VALUES, parseAssigneeIds } from "@/lib/mcp/tasks/validators";
import { normalizeBlockHtml } from "@/lib/mcp/normalizeBlockHtml";
import { formatRichTextInput, isAcceptedRichTextInput } from "@/utils/helperFunctions/markdownToHtml";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6561_DESCRIPTION_STRUCTURE_FLAG } from "@/lib/flags/keys";
import { buildFieldError } from "@/lib/mcp/fieldError";
import { parseContractFieldsInput, type ContractFieldUpdates } from "@/lib/mcp/tasks/contractFields";
import { hasSingleTaskUpdate } from "@/lib/mcp/tasks/updateFields";
import { parseGithubPullRequestUrl } from "@/lib/pullRequests/githubPullRequests";
import type { UpdateTaskBody } from './types';

export async function validateTaskUpdateFields(requestBody: UpdateTaskBody, dryRun: boolean, user: { id: number }) {
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
    const hasLabelPrecondition = requestBody.skip_if_labels_present !== undefined;
    const hasInvalidLabelPreconditionEntry =
        Array.isArray(requestBody.skip_if_labels_present) &&
        requestBody.skip_if_labels_present.some(
            label =>
                (typeof label !== 'string' && typeof label !== 'number') ||
                (typeof label === 'number' && !Number.isFinite(label))
        );
    if (
        hasLabelPrecondition &&
        (!Array.isArray(requestBody.skip_if_labels_present) ||
            requestBody.skip_if_labels_present.length === 0 ||
            requestBody.skip_if_labels_present.length > 50 ||
            hasInvalidLabelPreconditionEntry ||
            !hasLabelMutation)
    ) {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'invalid_field',
                    'skip_if_labels_present',
                    'skip_if_labels_present must contain 1-50 string or number labels and accompany add_labels or remove_labels'
                ),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        );
    }
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
    if (requestBody.description !== undefined && requestBody.description.trim().length === 0) {
        return NextResponse.json(
            {
                ...buildFieldError('invalid_field', 'description', 'Description cannot be empty'),
                ...(dryRun && { valid: false })
            },
            { status: 400 }
        )
    }
    if (
        requestBody.description !== undefined &&
        !isAcceptedRichTextInput(requestBody.description, requestBody.content_type) &&
        !(await isFeatureEnabled(HTPR_6561_DESCRIPTION_STRUCTURE_FLAG, user.id))
    ) {
        return NextResponse.json(
            {
                ...buildFieldError(
                    'invalid_field',
                    'description',
                    'Description must be HTML or structural markdown. Plain text is not enabled.'
                ),
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
            formatRichTextInput(requestBody.description, requestBody.content_type)
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

    return { assigneeUserIds, hasLabels, hasLabelMutation, hasDueDate, hasAssigneeField, hasDescriptionUpdate, hasTextOrParentUpdate, hasPullRequestUpdate, hasContractFieldUpdate, contractFieldUpdates, parsedPullRequest };
}
