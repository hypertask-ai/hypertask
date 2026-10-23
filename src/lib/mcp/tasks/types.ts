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
        fileSource: string;
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
    permanentlyDeleteAt: string | null;
    staleness: TaskStaleness;
    createdBy?: {
        id: number;
        email: string;
        displayName?: string;
        agent?: McpAgentSummary;
    };
}

export interface CreateTaskBody {
    project_id: number;
    title: string;
    dry_run?: boolean;
    description?: string;
    content_type?: 'html' | 'markdown';
    inline_images?: boolean;
    section_id?: number;
    priority?: number;
    estimate?: number;
    due_date?: string;
    images?: string[];
    labels?: (string | number)[];
    parent_task_id?: number;
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
