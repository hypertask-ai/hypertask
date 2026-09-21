import { HTMLElement, Node, parse } from 'node-html-parser';
import {
    mapAttributedMcpAgent,
    mapVisibleMcpAgent,
    mcpVisibleAgentSelect,
} from '@/lib/mcp/agents';
import { accessibleAgentWhere } from '@/lib/agents/visibility';
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

function safeDescriptionUrl(value: string | undefined): string | undefined {
    const url = value?.trim();
    return url && (/^https?:\/\//i.test(url) || url.startsWith('/'))
        ? url
        : undefined;
}

function descriptionNodeText(node: Node): string {
    if (node.nodeType === 3) return node.text;
    if (!(node instanceof HTMLElement)) return '';

    const tagName = String(node.rawTagName ?? '').toLowerCase();
    if (tagName === 'script' || tagName === 'style') return '';
    if (tagName === 'br') return ' ';
    if (tagName === 'img') {
        const source = safeDescriptionUrl(node.getAttribute('src'));
        return source ? `[image: ${source}]` : '';
    }

    const content = node.childNodes.map(descriptionNodeText).join(' ').trim();
    if (tagName !== 'a') return content;
    const href = safeDescriptionUrl(node.getAttribute('href'));
    if (!href || content === href) return content || href || '';
    return `${content} (${href})`;
}

export function mapTaskDescriptionText(task: {
    description_?: { content?: string } | null;
    description?: string;
}): string {
    const root = parse(mapTaskDescriptionContent(task), {
        comment: false,
        lowerCaseTagName: true,
    });
    return root.childNodes
        .map(descriptionNodeText)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function mapTaskAssignee(a: {
    user: { id: number; email: string; displayName: string | null };
    agent?: Parameters<typeof mapVisibleMcpAgent>[0];
    agentAssigner?: Parameters<typeof mapVisibleMcpAgent>[0];
}, userId: number, projectId: number, attributionEnabled = false): McpTaskAssignee | undefined {
    const agent = mapVisibleMcpAgent(a.agent, userId, projectId);
    if (attributionEnabled) {
        const attributedAgent = mapAttributedMcpAgent(a.agent);
        const attributedAssigner = mapAttributedMcpAgent(a.agentAssigner);
        if (attributedAgent) {
            return {
                displayName: attributedAgent.displayName,
                agent: attributedAgent,
                ...(attributedAssigner ? { agentAssigner: attributedAssigner } : {}),
            };
        }
        return {
            id: a.user.id,
            email: a.user.email,
            displayName: a.user.displayName || undefined,
            ...(attributedAssigner ? { agentAssigner: attributedAssigner } : {}),
        };
    }
    if (a.agent && !agent) return undefined;

    const mapped: McpTaskAssignee = {
        id: a.user.id,
        email: a.user.email,
        // An agent assignment stores the owner's user row. Print the agent
        // name, or task get and the CLI still show the owner.
        displayName: agent?.displayName || a.user.displayName || undefined,
    };
    const agentAssigner = mapVisibleMcpAgent(a.agentAssigner, userId, projectId);
    if (agent) mapped.agent = agent;
    if (agentAssigner) mapped.agentAssigner = agentAssigner;
    return mapped;
}

/** Nest the creating agent under createdBy the same way assignees nest agent. */
export function mapTaskCreatedBy(
    user: { id: number; email: string; displayName: string | null } | null | undefined,
    agent: Parameters<typeof mapVisibleMcpAgent>[0],
    userId: number,
    projectId: number,
    attributionEnabled = false,
): NonNullable<TaskDetail['createdBy']> | undefined {
    if (!user) return undefined;
    const createdBy: NonNullable<TaskDetail['createdBy']> = {
        id: user.id,
        email: user.email,
        displayName: user.displayName || undefined,
    };
    const visibleAgent = mapVisibleMcpAgent(agent, userId, projectId);
    if (attributionEnabled) {
        const attributedAgent = mapAttributedMcpAgent(agent);
        return attributedAgent
            ? { displayName: attributedAgent.displayName, agent: attributedAgent }
            : createdBy;
    }
    if (visibleAgent) createdBy.agent = visibleAgent;
    return createdBy;
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

export function taskDetailInclude(userId: number, attributionEnabled = false) {
    return {
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
        select: mcpVisibleAgentSelect(userId),
    },
    assignees: {
        where: {
            OR: [
                { agentId: null },
                { agent: accessibleAgentWhere(userId) },
            ],
        },
        ...(attributionEnabled ? { where: undefined } : {}),
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    displayName: true
                }
            },
            agent: { select: mcpVisibleAgentSelect(userId) },
            agentAssigner: { select: mcpVisibleAgentSelect(userId) },
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
}

/** GET /api/mcp/tasks single-task lookup (includes hierarchy fields). */
export function taskMcpGetInclude(userId: number, attributionEnabled = false) {
    return {
    ...taskDetailInclude(userId, attributionEnabled),
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
}

export function mapTaskToMcpGetResponse(
    task: any,
    userId: number,
    attributionEnabled = false,
) {
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
        description: mapTaskDescriptionText(task),
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
        assignees: (task.assignees ?? [])
            .map((assignee: any) =>
                mapTaskAssignee(assignee, userId, task.projectId, attributionEnabled)
            )
            .filter((assignee: McpTaskAssignee | undefined): assignee is McpTaskAssignee =>
                Boolean(assignee)
            ),
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
        createdBy: mapTaskCreatedBy(task.user, task.agent, userId, task.projectId),
    };
    if (attributionEnabled) {
        mapped.createdBy = mapTaskCreatedBy(
            task.user,
            task.agent,
            userId,
            task.projectId,
            true,
        );
    }

    const agent = attributionEnabled
        ? mapAttributedMcpAgent(task.agent)
        : mapVisibleMcpAgent(task.agent, userId, task.projectId);
    // Count the already-filtered, visibility-checked assignee list so the
    // number always matches what the response actually lists (HTPR-6279).
    // With attribution enabled, the mapper includes agent-only rows instead.
    const withAssigneeCount = { ...mapped, assigneeCount: mapped.assignees.length };
    return agent ? { ...withAssigneeCount, agent } : withAssigneeCount;
}

export function mapTaskToDetail(
    task: any,
    userId: number,
    attributionEnabled = false,
): TaskDetail {
    const descriptionContent = mapTaskDescriptionText(task);
    const taskAgent = attributionEnabled
        ? mapAttributedMcpAgent(task.agent)
        : mapVisibleMcpAgent(task.agent, userId, task.projectId);

    const mapped: TaskDetail = {
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
        assignees: task.assignees
            ?.map((assignee: any) =>
                mapTaskAssignee(assignee, userId, task.projectId, attributionEnabled)
            )
            .filter((assignee: McpTaskAssignee | undefined): assignee is McpTaskAssignee =>
                Boolean(assignee)
            ) || [],
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
        createdBy: mapTaskCreatedBy(task.user, task.agent, userId, task.projectId),
        ...(taskAgent ? { agent: taskAgent } : {}),
    };
    if (attributionEnabled) {
        mapped.createdBy = mapTaskCreatedBy(
            task.user,
            task.agent,
            userId,
            task.projectId,
            true,
        );
    }
    return mapped;
}
