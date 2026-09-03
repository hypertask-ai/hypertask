import { mapMcpAgent, mcpAgentSelect } from '@/lib/mcp/agents';
import { taskStaleness } from '@/lib/staleness';
import { derivePullRequestDisplayState } from '@/lib/pullRequests/githubPullRequests';
import { McpTaskAssignee, TaskDetail } from './types';


export const mcpTaskUserCommentCount = {
    where:{
        creatorId:{not:null}
    }
} as const;

export function mapTaskDescriptionContent(task: {
    description_?: { content?: string } | null;
    description?: string;
}): string {
    return task.description_?.content || task.description || '';
}

export function mapTaskAssignee(a: {
    user: { id: number; email: string; displayName: string | null };
    agent?: Parameters<typeof mapMcpAgent>[0];
    agentAssigner?: Parameters<typeof mapMcpAgent>[0];
}): McpTaskAssignee {
    const mapped: McpTaskAssignee = {
        id: a.user.id,
        email: a.user.email,
        displayName: a.user.displayName || undefined,
    };
    const agent = mapMcpAgent(a.agent);
    const agentAssigner = mapMcpAgent(a.agentAssigner);
    if (agent) mapped.agent = agent;
    if (agentAssigner) mapped.agentAssigner = agentAssigner;
    return mapped;
}

export const mcpTaskLabelSelect = {
    id: true,
    value: true,
} as const;

export function mapMcpTaskLabel(taskLabel: {
    label: { id: string | number; value: string | null };
}) {
    return {
        id: taskLabel.label.id,
        name: taskLabel.label.value || '',
    };
}

export const taskDetailInclude = {
    project: {
        select: {
            id: true,
            title: true,
            staleWarnDays: true,
            staleHotDays: true,
        }
    },
    priority: true,
    description_: true,
    estimate: true,
    agent: {
        select: mcpAgentSelect,
    },
    assignees: {
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    displayName: true
                }
            },
            agent: { select: mcpAgentSelect },
            agentAssigner: { select: mcpAgentSelect },
        }
    },
    followers: {
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    displayName: true
                }
            }
        }
    },
    taskLabels: {
        include: {
            label: {
                select: mcpTaskLabelSelect,
            }
        }
    },
    attachments: {
        select: {
            id: true,
            fileName: true,
            fileType: true,
            fileSize: true,
            fileSource: true
        }
    },
    user: {
        select: {
            id: true,
            email: true,
            displayName: true
        }
    },
    _count: {
        select: {
            comments: mcpTaskUserCommentCount
        }
    },
    pullRequests: {
        orderBy: { createdAt: 'asc' as const },
        select: {
            id: true,
            repositoryOwner: true,
            repositoryName: true,
            number: true,
            url: true,
            title: true,
            lifecycle: true,
            checkState: true,
            headSha: true,
            updatedAt: true,
        },
    },
};

/** GET /api/mcp/tasks single-task lookup (includes hierarchy fields). */
export const taskMcpGetInclude = {
    ...taskDetailInclude,
    attachments: {
        select: {
            id: true,
            fileName: true,
            fileType: true,
            fileSize: true,
        },
    },
    subTasks: {
        select: {
            id: true,
            ticketNumber: true,
            title: true,
            uniqueIndex: true,
        },
    },
    parentTask: {
        select: {
            id: true,
            ticketNumber: true,
            title: true,
            uniqueIndex: true,
        },
    },
    customFieldValues: {
        select: {
            value: true,
            field: {
                select: {
                    name: true,
                    type: true,
                },
            },
        },
    },
};

export function mapTaskToMcpGetResponse(task: any) {
    const subTasks = Array.isArray(task.subTasks)
        ? task.subTasks.map(
              (st: {
                  id: number;
                  ticketNumber: string;
                  title: string;
                  uniqueIndex: number;
              }) => ({
                  id: st.id,
                  ticketNumber: st.ticketNumber || undefined,
                  title: st.title,
                  uniqueIndex: st.uniqueIndex,
              })
          )
        : [];

    const mapped = {
        id: task.id,
        ticketNumber: task.ticketNumber || undefined,
        uniqueIndex: task.uniqueIndex,
        // Ready-made board-relative link. Callers/LLMs must use this verbatim,
        // never build the path from `id` (that is the global DB id, not the ticket number).
        url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
        title: task.title,
        section: task.section,
        sectionId: task.sectionId || undefined,
        description: mapTaskDescriptionContent(task),
        boardId: task.projectId,
        boardTitle: task.project.title || '',
        parent_id: task.parentTaskId || undefined,
        parent_task: task.parentTask
            ? {
                  id: task.parentTask.id,
                  ticketNumber: task.parentTask.ticketNumber || undefined,
                  title: task.parentTask.title,
                  uniqueIndex: task.parentTask.uniqueIndex,
              }
            : undefined,
        sub_tasks: subTasks,
        projectId: task.projectId,
        status: task.status,
        priority: task.priority
            ? {
                  id: task.priority.id,
                  priority_index: task.priority.priority_index,
                  Priority_Value: task.priority.Priority_Value,
              }
            : undefined,
        estimate: task.estimate
            ? {
                  id: task.estimate.id,
                  estimate_index: task.estimate.estimate_index,
                  estimate_value: task.estimate.estimate_value,
              }
            : undefined,
        dueDate: task.dueDate?.toISOString() || undefined,
        riskLevel: task.riskLevel ? (task.riskLevel.toLowerCase() as 'low' | 'medium' | 'high') : undefined,
        acceptanceCriteria: task.acceptanceCriteria || undefined,
        verifyCommand: task.verifyCommand || undefined,
        assignees: (task.assignees ?? []).map(mapTaskAssignee),
        followers: (task.followers ?? []).map((f: { user: { id: number; email: string; displayName: string | null } }) => ({
            id: f.user.id,
            email: f.user.email,
            displayName: f.user.displayName || undefined,
        })),
        labels: (task.taskLabels ?? []).map(mapMcpTaskLabel),
        attachments: (task.attachments ?? []).map((a: { id: number; fileName: string | null; fileType: string; fileSize: string | number | null }) => ({
            id: a.id,
            fileName: a.fileName || '',
            fileType: a.fileType,
            fileSize: a.fileSize ? (typeof a.fileSize === 'string' ? parseInt(a.fileSize) || 0 : a.fileSize) : 0,
        })),
        customFieldValues: (task.customFieldValues ?? []).map((customFieldValue: {
            value: string;
            field: { name: string; type: string };
        }) => ({
            name: customFieldValue.field.name,
            type: customFieldValue.field.type,
            value: customFieldValue.value,
        })),
        savedContent: (task.savedContent ?? []).map((saved: { id: string; type: string }) => ({
            id: saved.id,
            type: saved.type,
        })),
        pullRequests: (task.pullRequests ?? []).map((pullRequest: any) => ({
            id: pullRequest.id,
            repositoryOwner: pullRequest.repositoryOwner,
            repositoryName: pullRequest.repositoryName,
            number: pullRequest.number,
            url: pullRequest.url,
            title: pullRequest.title,
            lifecycle: pullRequest.lifecycle,
            checkState: pullRequest.checkState,
            displayState: derivePullRequestDisplayState(
                pullRequest.lifecycle,
                pullRequest.checkState,
            ),
            headSha: pullRequest.headSha ?? null,
            updatedAt: pullRequest.updatedAt?.toISOString?.() ?? pullRequest.updatedAt,
        })),
        totalComments: task._count.comments,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt?.toISOString() || undefined,
        permanentlyDeleteAt: task.permanentlyDeleteAt?.toISOString() || null,
        staleness: taskStaleness(task, {
            warnDays: task.project?.staleWarnDays,
            hotDays: task.project?.staleHotDays,
        }),
        createdBy: task.user
            ? {
                  id: task.user.id,
                  email: task.user.email,
                  displayName: task.user.displayName || undefined,
              }
            : undefined,
    };

    const agent = mapMcpAgent(task.agent);
    return agent ? { ...mapped, agent } : mapped;
}

export function mapTaskToDetail(task: any): TaskDetail {
    const descriptionContent = mapTaskDescriptionContent(task);
    const taskAgent = mapMcpAgent(task.agent);

    return {
        id: task.id,
        ticketNumber: task.ticketNumber || undefined,
        title: task.title,
        description: descriptionContent,
        descriptionJson: task.descriptionJson || undefined,
        section: task.section,
        sectionId: task.sectionId || 0,
        boardId: task.projectId,
        boardTitle: task.project.title || '',
        projectId: task.projectId,
        status: task.status,
        priority: task.priority ? {
            id: String(task.priority.id),
            priority_index: task.priority.priority_index,
            Priority_Value: task.priority.Priority_Value as 'No Priority' | 'Urgent' | 'High' | 'Medium' | 'Low'
        } : undefined,
        estimate: task.estimate ? {
            id: String(task.estimate.id),
            estimate_index: task.estimate.estimate_index,
            estimate_value: task.estimate.estimate_value,
            estimate_full_value: task.estimate.estimate_full_value || undefined
        } : undefined,
        dueDate: task.dueDate?.toISOString() || undefined,
        riskLevel: task.riskLevel ? (task.riskLevel.toLowerCase() as 'low' | 'medium' | 'high') : undefined,
        acceptanceCriteria: task.acceptanceCriteria || undefined,
        verifyCommand: task.verifyCommand || undefined,
        assignees: task.assignees?.map(mapTaskAssignee) || [],
        followers: task.followers?.map((f: any) => ({
            id: f.user.id,
            email: f.user.email,
            displayName: f.user.displayName || undefined
        })) || [],
        labels: task.taskLabels?.map((tl: any) => ({
            id: String(tl.label.id),
            name: tl.label.value || '',
            color: undefined
        })) || [],
        attachments: task.attachments?.map((a: any) => ({
            id: a.id,
            fileName: a.fileName || '',
            fileType: a.fileType,
            fileSize: a.fileSize ? (typeof a.fileSize === 'string' ? parseInt(a.fileSize) || 0 : a.fileSize) : 0,
            fileSource: a.fileSource || ''
        })) || [],
        pullRequests: (task.pullRequests ?? []).map((pullRequest: any) => ({
            id: pullRequest.id,
            repositoryOwner: pullRequest.repositoryOwner,
            repositoryName: pullRequest.repositoryName,
            number: pullRequest.number,
            url: pullRequest.url,
            title: pullRequest.title,
            lifecycle: pullRequest.lifecycle,
            checkState: pullRequest.checkState,
            displayState: derivePullRequestDisplayState(
                pullRequest.lifecycle,
                pullRequest.checkState,
            ),
            headSha: pullRequest.headSha ?? null,
            updatedAt: pullRequest.updatedAt?.toISOString?.() ?? pullRequest.updatedAt,
        })) || [],
        totalComments: task._count?.comments || 0,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt?.toISOString() || task.createdAt.toISOString(),
        permanentlyDeleteAt: task.permanentlyDeleteAt?.toISOString() || null,
        staleness: taskStaleness(task, {
            warnDays: task.project?.staleWarnDays,
            hotDays: task.project?.staleHotDays,
        }),
        createdBy: task.user ? {
            id: task.user.id,
            email: task.user.email,
            displayName: task.user.displayName || undefined
        } : undefined,
        ...(taskAgent ? { agent: taskAgent } : {}),
    };
}
