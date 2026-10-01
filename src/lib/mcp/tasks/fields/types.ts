import type { McpAuthContext } from '@/lib/mcp/auth';
import type { McpAgentSummary } from '@/lib/mcp/agents';
import type { NextRequest, NextResponse } from 'next/server';
import type { TaskDetail } from '@/lib/mcp/tasks/types';
import type { linkTaskPullRequest } from '@/lib/pullRequests/taskPullRequests';
import type { EstimateConstants, PriorityConstants } from '@/lib/constants/constants';
import type { ActingAgent } from '@/lib/agents/activityAttribution';
import type { ContractFieldUpdates } from '@/lib/mcp/tasks/contractFields';
import type { parseGithubPullRequestUrl } from '@/lib/pullRequests/githubPullRequests';

export interface UpdateTaskResponse {
    success: boolean;
    tasks: TaskDetail[];
    idempotent_replayed?: true;
    task?: TaskDetail; // Backward compatibility - included when updating a single task
    /** MCP session agent that performed this action */
    agent?: McpAgentSummary;
    message?: string;
    failed_tasks?: Array<{ taskId: number; error: string; status?: number; code?: string }>;
}

export interface UpdateTaskErrorResponse {
    success: false;
    tasks: TaskDetail[];
    error: string;
    code?: string;
}

export class UpdateTaskPersistenceError extends Error {
    constructor(
        readonly response: UpdateTaskErrorResponse,
        readonly status: number = 500,
    ) {
        super(response.error)
        this.name = 'UpdateTaskPersistenceError'
    }
}

export type TaskUpdateResult =
    | { success: true; taskId: number }
    | {
          success: false
          taskId: number
          error: string
          status?: number
          code?: string
      }

export const VALID_STATUSES = ['Normal', 'Archive', 'Deleted'] as const;

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
    skip_if_labels_present?: (string | number)[];
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

export interface ExecuteTaskUpdateOptions {
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

export interface TaskUpdateFieldContext {
    request: NextRequest;
    ctx: McpAuthContext;
    user: McpAuthContext['user'];
    requestBody: UpdateTaskBody;
    userObj: Parameters<NonNullable<ExecuteTaskUpdateOptions['assignAssignees']>>[0]['user'];
    baseUrl: string;
    authCookieHeader: string;
    sectionInfo: { section_title: string; projectId: number } | undefined;
    priorityConstant: typeof PriorityConstants[number] | null | undefined;
    estimateConstant: typeof EstimateConstants[number] | null | undefined;
    hasDueDate: boolean;
    hasTextOrParentUpdate: boolean;
    hasDescriptionUpdate: boolean;
    hasLabels: boolean;
    hasLabelMutation: boolean;
    hasContractFieldUpdate: boolean;
    contractFieldUpdates: ContractFieldUpdates;
    parsedPullRequest: ReturnType<typeof parseGithubPullRequestUrl>;
    assigneeUserIds: number[] | undefined;
    assignAssignees: ExecuteTaskUpdateOptions['assignAssignees'];
    clearAssignees: ExecuteTaskUpdateOptions['clearAssignees'];
    linkPullRequest: typeof linkTaskPullRequest;
    strictSideEffectFailures: boolean;
}

export type TaskUpdateTarget = { id: number; sectionId: number | null; projectId: number; status: string };
export type TaskUpdateActingAgent = ActingAgent | null;
