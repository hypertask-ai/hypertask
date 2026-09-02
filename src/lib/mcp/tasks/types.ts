import type { McpAgentSummary } from '@/lib/mcp/agents';
import type { TaskStaleness } from '@/lib/staleness';

export interface McpTaskAssignee {
    id: number;
    email: string;
    displayName?: string;
    agent?: McpAgentSummary;
    agentAssigner?: McpAgentSummary;
}

export interface TaskDetail {
    id: number;
    ticketNumber?: string;
    title: string;
    description: string;
    descriptionJson?: unknown;
    section: string;
    sectionId: number;
    boardId: number;
    boardTitle: string;
    projectId: number;
    status: 'Normal' | 'Archive' | 'Deleted';
    priority?: {
        id: string;
        priority_index: number;
        Priority_Value: 'No Priority' | 'Urgent' | 'High' | 'Medium' | 'Low';
    };
    estimate?: {
        id: string;
        estimate_index: number;
        estimate_value: string;
        estimate_full_value?: string;
    };
    dueDate?: string;
    riskLevel?: 'low' | 'medium' | 'high';
    acceptanceCriteria?: string;
    verifyCommand?: string;
    agent?: McpAgentSummary;
    assignees?: McpTaskAssignee[];
    followers?: Array<{
        id: number;
        email: string;
        displayName?: string;
    }>;
    labels?: Array<{
        id: string;
        name: string;
        color?: string;
    }>;
    attachments?: Array<{
        id: number;
        fileName: string;
        fileType: string;
        fileSize: number;
        fileSource: string; // URL to the attachment
    }>;
    pullRequests?: Array<{
        id: string;
        repositoryOwner: string;
        repositoryName: string;
        number: number;
        url: string;
        title: string;
        lifecycle: 'open' | 'closed' | 'merged';
        checkState: 'pending' | 'passing' | 'failing';
        displayState: 'open' | 'checks_red' | 'green' | 'merged';
        headSha: string | null;
        updatedAt: string;
    }>;
    totalComments: number;
    createdAt: string;
    updatedAt: string;
    staleness: TaskStaleness;
    createdBy?: {
        id: number;
        email: string;
        displayName?: string;
    };
}

export interface CreateTaskBody {
    project_id: number;
    title: string;
    dry_run?: boolean;
    description?: string;
    content_type?: 'html' | 'markdown';
    section_id?: number;
    priority?: number;
    estimate?: number;
    due_date?: string; // ISO 8601 date or datetime (e.g. "2026-03-10" or "2026-03-10T00:00:00Z")
    images?: string[]; // Array of S3 image URLs
    labels?: (string | number)[]; // Label IDs to assign to the task
    parent_task_id?: number; // Parent task ID to assign to the task
    assignee_ids?: number[];
}

export interface ValidationError {
    success: false;
    error: string;
    message: string;
    details?: {
        field: string;
        code: string;
    };
    correlationId?: string | null;
}
