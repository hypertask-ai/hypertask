import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';
import { taskDetailInclude } from './mappers';
import { PriorityConstants, EstimateConstants } from '@/lib/constants/constants';
import createLabelActivity from '@/utils/controllers/activities/createLabelActivity';
import {
    buildMcpImageUrls,
    persistUrlsForDescription,
} from '@/utils/controllers/urls/extractUrlsFromContent';
import { IUser } from '@/models/model';
import { signSession, SESSION_COOKIE } from '@/lib/auth/session';
import { slimUserForCookie } from '@/lib/auth/slimUserCookie';
import {
    persistAgentTaskUpdatedWebhook,
    publishAgentWebhookDeliveries,
} from '@/lib/agentWebhooks/outbox';
import type { AgentWebhookTaskLabel } from '@/lib/agentWebhooks/events';

const agentLabelRefs = (
    taskLabels: Array<{ label: { id: string; value: string | null } }>,
): AgentWebhookTaskLabel[] =>
  taskLabels.map(({ label }) => ({ id: label.id, value: label.value }));

export class TaskProjectScopeError extends Error {
    readonly statusCode = 404;

    constructor(taskId: number) {
        super(`Task ${taskId} was not found in the requested project`);
        this.name = 'TaskProjectScopeError';
    }
}

async function emitAgentLabelChangeWebhook(
    tx: Prisma.TransactionClient,
    taskId: number,
    userObj: { id: number; displayName?: string | null },
    before: Array<{ label: { id: string; value: string | null } }>,
    after: Array<{ label: { id: string; value: string | null } }>,
): Promise<string[]> {
    return persistAgentTaskUpdatedWebhook(tx, {
        taskId,
        actor: { userId: userObj.id, displayName: userObj.displayName },
        changes: {
            labels: {
                from: agentLabelRefs(before),
                to: agentLabelRefs(after),
            },
        },
    });
}

export async function validateProjectAccess(
    projectId: number,
    userId: number,
    agentId?: string | null
): Promise<{ project: any; error: null } | { project: null; error: { status: number; message: string } }> {
    // Check if project exists
    const projectExists = await prisma.project.findFirst({
        where: { id: projectId, status: 'Normal' },
        select: { id: true }
    });

    if (!projectExists) {
        return {
            project: null,
            error: { status: 404, message: `Project with ID ${projectId} not found` }
        };
    }

    const project = await prisma.project.findFirst({
        where: {
            id: projectId,
            status: 'Normal',
            ...getProjectWhere(userId, agentId),
        },
        select: {
            id: true,
            title: true,
            uniqueIdentifier: true,
            teamId: true
        }
    });

    if (!project) {
        return {
            project: null,
            error: { status: 403, message: 'User does not have permission to create tasks in this project' }
        };
    }

    return { project, error: null };
}

export async function validateParentTask(
    projectId: number,
    parentTaskId?: number
): Promise<{ error: null } | { error: { status: number; message: string } }> {
    if (!parentTaskId) return { error: null };

    const parent = await prisma.task.findFirst({
        where: { id: parentTaskId, projectId, status: { not: 'Deleted' } },
        select: { id: true }
    });

    if (!parent) {
        return { error: { status: 404, message: `Parent task with ID ${parentTaskId} not found in this project` } };
    }

    return { error: null };
}

export async function getSectionForTask(
    projectId: number,
    sectionId?: number
): Promise<{ section: any; error: null } | { section: null; error: { status: number; message: string } }> {
    let section;

    if (sectionId) {
        section = await prisma.section.findFirst({
            where: {
                id: sectionId,
                projectId,
                deleted: false
            }
        });

        if (!section) {
            return {
                section: null,
                error: { status: 404, message: `Section with ID ${sectionId} not found in project ${projectId}` }
            };
        }
    } else {
        section = await prisma.section.findFirst({
            where: {
                projectId,
                visibility: true,
                deleted: false
            },
            orderBy: { ranking: 'asc' }
        });

        if (!section) {
            return {
                section: null,
                error: { status: 404, message: `No default section found in project ${projectId}` }
            };
        }
    }

    return { section, error: null };
}

export async function validateProjectMemberIds(
    projectId: number,
    userIds: number[]
): Promise<{ invalidIds: number[]; error: null } | { invalidIds: null; error: { status: number; message: string } }> {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) {
        return { invalidIds: [], error: null };
    }

    const project = await prisma.project.findFirst({
        where: { id: projectId, status: 'Normal' },
        select: {
            ownerId: true,
            members: {
                where: { agentId: null },
                select: { userId: true }
            }
        }
    });

    if (!project) {
        return {
            invalidIds: null,
            error: { status: 404, message: `Project with ID ${projectId} not found` }
        };
    }

    const allowedMemberIds = new Set([
        project.ownerId,
        ...project.members.map((member) => member.userId)
    ]);
    const invalidIds = uniqueUserIds.filter((userId) => !allowedMemberIds.has(userId));

    return { invalidIds, error: null };
}

/**
 * Match label names OR ids against a project's labels.
 *
 * Callers (the AI chat especially) naturally pass human label names like "AI",
 * because that is what the user typed. Matching on id alone made every
 * name-based call fail with "Label(s) not found", so names are matched here
 * case-insensitively and whitespace-tolerantly.
 */
export function matchLabelIds(
    projectLabels: { id: string; value: string | null }[],
    labels: (string | number)[]
): { ids: string[]; unresolved: string[] } {
    const byId = new Set(projectLabels.map(label => label.id));
    const byName = new Map(
        projectLabels
            .filter(label => label.value)
            .map(label => [label.value!.trim().toLowerCase(), label.id])
    );

    const ids: string[] = [];
    const unresolved: string[] = [];
    for (const entry of labels.map(label => String(label))) {
        const id = byId.has(entry)
            ? entry
            : byName.get(entry.trim().toLowerCase());
        if (id) {
            if (!ids.includes(id)) ids.push(id);
        } else {
            unresolved.push(entry);
        }
    }
    return { ids, unresolved };
}

export async function resolveLabelIds(
    projectId: number,
    labels: (string | number)[]
): Promise<string[]> {
    if (labels.length === 0) return [];

    const projectLabels = await prisma.label.findMany({
        where: { projectId },
        select: { id: true, value: true }
    });

    const { ids, unresolved } = matchLabelIds(projectLabels, labels);
    if (unresolved.length > 0) {
        const available = projectLabels
            .map(label => label.value)
            .filter(Boolean)
            .join(', ');
        throw new Error(
            `Label(s) not found in project: ${unresolved.join(', ')}. Available labels: ${available || 'none'}`
        );
    }

    return ids;
}

async function assertTaskBelongsToProject(
    tx: Prisma.TransactionClient,
    taskId: number,
    projectId: number,
): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ projectId: number }>>`
        SELECT "projectId"
        FROM "Task"
        WHERE "id" = ${taskId}
          AND "projectId" = ${projectId}
        FOR UPDATE
    `;
    if (rows.length === 0) {
        throw new TaskProjectScopeError(taskId);
    }
}

/**
 * Replace all labels on a task and log only the labels whose assignment changed.
 */
export async function setTaskLabels(
    taskId: number,
    projectId: number,
    labelIds: (string | number)[],
    userObj: { id: number; email: string; displayName?: string | null; photoURL?: string | null }
): Promise<void> {
    const resolvedIds = await resolveLabelIds(projectId, labelIds);
    const deliveryIds = await prisma.$transaction(async (tx) => {
        await assertTaskBelongsToProject(tx, taskId, projectId);
        const existingTaskLabels = await tx.taskLabel.findMany({
            where: { taskId },
            include: { label: true }
        });
        const resolvedIdSet = new Set(resolvedIds);
        const existingIdSet = new Set(existingTaskLabels.map(taskLabel => taskLabel.labelId));
        const removedTaskLabels = existingTaskLabels.filter(
            taskLabel => !resolvedIdSet.has(taskLabel.labelId)
        );
        const addedLabelIds = resolvedIds.filter(labelId => !existingIdSet.has(labelId));
        if (removedTaskLabels.length > 0) {
            await tx.taskLabel.deleteMany({
                where: {
                    taskId,
                    labelId: { in: removedTaskLabels.map(taskLabel => taskLabel.labelId) }
                }
            });

            for (const taskLabel of removedTaskLabels) {
                await createLabelActivity({
                    userObj: userObj as any,
                    toTaskLabel: taskLabel as any,
                    taskId,
                    status: 'Removed',
                    transaction: tx,
                });
            }
        }

        for (const labelId of addedLabelIds) {
            const taskLabel = await tx.taskLabel.create({
                data: { taskId, labelId },
                include: { label: true }
            });
            await createLabelActivity({
                userObj: userObj as any,
                toTaskLabel: taskLabel as any,
                taskId,
                status: 'Assigned',
                transaction: tx,
            });
        }

        if (removedTaskLabels.length === 0 && addedLabelIds.length === 0) return [];

        const finalTaskLabels = await tx.taskLabel.findMany({
            where: { taskId },
            include: { label: true },
        });
        return emitAgentLabelChangeWebhook(
            tx,
            taskId,
            userObj,
            existingTaskLabels,
            finalTaskLabels,
        );
    });
    try {
      await publishAgentWebhookDeliveries(deliveryIds);
    } catch (error) {
        // The outbox row committed with the label mutation. The queue helper
        // and the agent-webhook outbox sweeper retry publication failures.
        console.warn('[task-labels] queue publish failed; outbox sweep will retry', error);
    }
}

/**
 * Add and/or remove labels on a task without touching the ones it already has.
 * Unlike setTaskLabels, this never wipes labels the caller did not mention, so a
 * "swap tag A for tag B" never silently drops the task's other tags.
 */
export async function mutateTaskLabels(
    taskId: number,
    projectId: number,
    changes: {
        add?: (string | number)[];
        remove?: (string | number)[];
        skipIfPresent?: (string | number)[];
    },
    userObj: { id: number; email: string; displayName?: string | null; photoURL?: string | null }
): Promise<void> {
    const addIds = await resolveLabelIds(projectId, changes.add ?? []);
    const removeIds = await resolveLabelIds(projectId, changes.remove ?? []);
    const skipIfPresentIds = await resolveLabelIds(projectId, changes.skipIfPresent ?? []);
    const deliveryIds = await prisma.$transaction(async (tx) => {
        await assertTaskBelongsToProject(tx, taskId, projectId);
        const existing = await tx.taskLabel.findMany({
            where: { taskId },
            include: { label: true },
        });
        const existingIds = new Set(existing.map(row => row.labelId));
        if (skipIfPresentIds.some(labelId => existingIds.has(labelId))) return [];
        let changed = false;

        for (const labelId of removeIds) {
            if (!existingIds.has(labelId)) continue;
            const taskLabel = existing.find(row => row.labelId === labelId);
            await tx.taskLabel.deleteMany({ where: { taskId, labelId } });
            changed = true;
            if (taskLabel) {
                await createLabelActivity({
                    userObj: userObj as any,
                    toTaskLabel: taskLabel as any,
                    taskId,
                    status: 'Removed',
                    transaction: tx,
                });
            }
        }

        for (const labelId of addIds) {
            if (existingIds.has(labelId) || removeIds.includes(labelId)) continue;
            const taskLabel = await tx.taskLabel.create({
                data: { taskId, labelId },
                include: { label: true }
            });
            changed = true;
            await createLabelActivity({
                userObj: userObj as any,
                toTaskLabel: taskLabel as any,
                taskId,
                status: 'Assigned',
                transaction: tx,
            });
        }

        if (!changed) return [];

        const finalTaskLabels = await tx.taskLabel.findMany({
            where: { taskId },
            include: { label: true },
        });
        return emitAgentLabelChangeWebhook(
            tx,
            taskId,
            userObj,
            existing,
            finalTaskLabels,
        );
    });
    try {
      await publishAgentWebhookDeliveries(deliveryIds);
    } catch (error) {
        // The outbox row committed with the label mutation. The queue helper
        // and the agent-webhook outbox sweeper retry publication failures.
        console.warn('[task-labels] queue publish failed; outbox sweep will retry', error);
    }
}

export async function createTask(data: {
    projectId: number;
    title: string;
    description: string;
    sectionId: number;
    sectionTitle: string;
    userId: number;
    priorityIndex: number;
    estimateIndex: number;
    dueDate?: Date; // ISO 8601 parsed date
    projectUniqueIdentifier: string | null;
    teamId: string | null;
    images?: string[]; // Array of S3 image URLs
    labels?: (string | number)[]; // Label IDs to assign
    parentTaskId?: number; // Parent task ID to assign to the task
    assigneeIds?: number[]; // User IDs to assign as assignees
    agentId?: string | null;
}) {
    const { projectId, title, description, sectionId, sectionTitle, userId, priorityIndex, estimateIndex, projectUniqueIdentifier, labels: labelIds, parentTaskId, agentId, assigneeIds } = data;

    if (!projectUniqueIdentifier) {
        throw new Error('Project identifier is required');
    }

    // Validate and resolve labels (must belong to project)
    let tags: { id: string }[] = [];
    if (labelIds && labelIds.length > 0) {
        const validLabels = await prisma.label.findMany({
            where: {
                id: { in: labelIds.map(id => String(id)) },
                projectId
            },
            select: { id: true }
        });
        const validIds = new Set(validLabels.map(l => l.id));
        const invalidIds = labelIds.filter(id => !validIds.has(String(id)));
        if (invalidIds.length > 0) {
            throw new Error(`Label(s) not found in project: ${invalidIds.join(', ')}`);
        }
        tags = validLabels.map(l => ({ id: l.id }));
    }

    // Get user object for createGlobally (it expects currentUser from cookies)
    // Include photoURL so activity log avatars display correctly
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            displayName: true,
            photoURL: true
        }
    });

    if (!user) {
        throw new Error('User not found');
    }

    // Prepare priority/estimate objects in the format createGlobally expects
    const priority = priorityIndex > 0 
        ? PriorityConstants.find(p => p.priority_index === priorityIndex)
        : undefined;
    
    const estimate = estimateIndex > 0
        ? EstimateConstants.find(e => e.estimate_index === estimateIndex)
        : undefined;

    // Get ranking (createGlobally expects it)
    const lastTask = await prisma.task.findFirst({
        where: {
            sectionId,
            projectId,
            status: 'Normal'
        },
        orderBy: { ranking: 'desc' },
        select: { ranking: true }
    });

    const generateRank = (await import('@/utils/generateRank')).default;
    const ranking = generateRank(lastTask?.ranking, undefined);

    // Convert images array to IUrl format for createGlobally
    const urlsToAdd = data.images && data.images.length > 0
        ? data.images.map((imageUrl: string) => {
            // Extract file extension from URL to determine file type
            const urlPath = new URL(imageUrl).pathname;
            const extension = urlPath.split('.').pop()?.toLowerCase() || 'jpg';
            
            // Map common image extensions to MIME types
            const mimeTypeMap: Record<string, string> = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'svg': 'image/svg+xml',
                'bmp': 'image/bmp'
            };
            
            const fileType = mimeTypeMap[extension] || 'image/jpeg';
            const fileName = `image-${Date.now()}.${extension}`;
            
            return {
                urlString: imageUrl,
                TaskId: 0, // Will be set after task creation
                Attachment: true,
                attachmentType: fileType,
                title: fileName
            };
        })
        : undefined;

    // Call the existing createGlobally API endpoint internally
    // Use absolute URL for internal calls
    const baseUrl = process.env.NEXT_PUBLIC_BASEURL 
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    
    const apiUrl = `${baseUrl}/api/tasks/createGlobally`;
    
    // Create a cookie string for the user (createGlobally expects nookies_user cookie)
    // Include photoURL so activity log avatars display correctly when tasks are created via MCP
    const userCookie = JSON.stringify(slimUserForCookie({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL ?? undefined
    }));
    const sessionToken = signSession({ id: user.id, email: user.email });
    const authCookieHeader = `nookies_user=${encodeURIComponent(userCookie)}; ${SESSION_COOKIE}=${sessionToken}`;

    let assigneesMinimal: any[] | undefined = undefined
    if (assigneeIds && assigneeIds.length > 0) {
        // Only project owner/members may be assigned. Without this, any caller could
        // assign an arbitrary internal user id, who then gets a notification/email
        // with the task title and link. Mirrors the mentions check on the comment
        // route and the AI chat write tools. See HTPR-3964.
        const memberCheck = await validateProjectMemberIds(projectId, assigneeIds);
        if (memberCheck.error) {
            throw new Error(memberCheck.error.message);
        }
        if (memberCheck.invalidIds.length > 0) {
            throw new Error(
                `User(s) ${memberCheck.invalidIds.join(', ')} are not members of this project and cannot be assigned.`
            );
        }
        assigneesMinimal = await prisma.user.findMany({
            where: {
                id: {
                    in: assigneeIds,
                },
            },
            select: {
                id: true,
                displayName: true,
                photoURL: true,
                email: true,
                uid: true,
            },
        });
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': authCookieHeader
        },
        body: JSON.stringify({
            title,
            userId,
            projectId,
            projectIdentifier: projectUniqueIdentifier,
            ranking,
            section_title: sectionTitle,
            sectionId,
            priority,
            estimate,
            description,
            dueDate: data.dueDate ?? undefined,
            tags,
            parentTask: undefined,
            relationsToAdd: undefined,
            urlsToAdd: urlsToAdd,
            assignees: assigneesMinimal,
            createTaskFromComment: undefined,
            parentTaskId: parentTaskId ?? undefined,
            agentId,
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to create task' }));
        throw new Error(errorData.message || `API call failed with status ${response.status}`);
    }

    const result = await response.json();
    
    if (result.error) {
        throw new Error(result.message || 'Failed to create task');
    }

    // Fetch complete task with all relations for MCP response format
    const taskWithDescription = await prisma.task.findUnique({
        where: { id: result.newTask.id },
        include: taskDetailInclude(userId)
    });

    if (!taskWithDescription) {
        throw new Error('Task was created but could not be retrieved');
    }

    const imageUrls =
        data.images && data.images.length > 0
            ? buildMcpImageUrls(data.images, taskWithDescription.id)
            : [];

    await persistUrlsForDescription(
        description,
        taskWithDescription.id,
        imageUrls
    );

    return taskWithDescription;
}
