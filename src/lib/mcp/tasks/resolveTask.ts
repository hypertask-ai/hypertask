import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { findPrefixAliasTasks } from '@/utils/controllers/projects/findPrefixAliasTasks';
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';

export class TaskIdentifierAmbiguityError extends Error {
  constructor(ticketNumber: string) {
    super(`Ticket number ${ticketNumber} is ambiguous across accessible projects; provide project_id.`);
    this.name = 'TaskIdentifierAmbiguityError';
  }
}

/**
 * Resolve a task by MCP identifier with project access rules
 * (human owner/member or agent board membership).
 */
export async function findTaskByIdentifier(
  user: { id: number },
  options: {
    task_id?: number | null;
    ticket_number?: string | null;
    unique_index?: number | null;
    project_id?: number | null;
  },
  agentId?: string | null,
  projectAccess?: Prisma.ProjectWhereInput,
) {
  const { task_id, ticket_number, unique_index, project_id } = options;
  const projectFilter = projectAccess ?? getProjectWhere(user.id, agentId);

  if (task_id) {
    return await prisma.task.findFirst({
      where: {
        id: task_id,
        ...(project_id ? { projectId: project_id } : {}),
        status: { not: 'Deleted' },
        project: projectFilter,
      },
      select: { id: true, projectId: true },
    });
  }

  if (!ticket_number && (unique_index == null || project_id == null)) return null;

  const identityWhere = ticket_number
    ? { ticketNumber: ticket_number, ...(project_id ? { projectId: project_id } : {}) }
    : { projectId: project_id!, uniqueIndex: unique_index! };
  const matches = await prisma.task.findMany({
    where: { ...identityWhere, status: { not: 'Deleted' }, project: projectFilter },
    select: { id: true, projectId: true },
    orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
    take: project_id ? 1 : 2,
  });
  if (!project_id && matches.length > 1) {
    throw new TaskIdentifierAmbiguityError(ticket_number!);
  }
  if (matches.length) return matches[0];

  // A real ticket wins even when it is inaccessible to this caller.
  const liveTask = await prisma.task.findFirst({
    where: { ...identityWhere, status: { not: 'Deleted' } },
    select: { id: true },
  });
  if (liveTask) return null;

  const aliases = await prisma.taskNumberAlias.findMany({
    where: {
      ...identityWhere,
      ...(ticket_number ? { ticketNumber: { equals: ticket_number, mode: 'insensitive' as const } } : {}),
      task: { status: { not: 'Deleted' }, project: projectFilter },
    },
    select: { projectId: true, uniqueIndex: true, task: { select: { id: true, projectId: true } } },
    orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
  });
  if (!aliases.length && !ticket_number) return null;
  const reusedNumbers = await prisma.task.findMany({
    where: {
      OR: aliases.map(({ projectId, uniqueIndex }) => ({ projectId, uniqueIndex })),
      status: { not: 'Deleted' },
    },
    select: { projectId: true, uniqueIndex: true },
  });
  const availableAliases = aliases.filter(alias => !reusedNumbers.some(
    task => task.projectId === alias.projectId && task.uniqueIndex === alias.uniqueIndex
  ));
  const tasks = [...new Map(availableAliases.map(({ task }) => [task.id, task])).values()];
  if (!tasks.length && ticket_number) {
    tasks.push(...await findPrefixAliasTasks(ticket_number, projectFilter, project_id));
  }
  if (!project_id && tasks.length > 1) {
    throw new TaskIdentifierAmbiguityError(ticket_number!);
  }
  return tasks[0] ?? null;
}

/**
 * Turn any MCP task identifier into a numeric id, applying NO project scope.
 *
 * For routes that already run their own access check and only need to accept a
 * ticket number in addition to a raw id. Resolving here and leaving the check
 * where it is means adding the friendlier identifiers cannot quietly widen or
 * narrow who is allowed to read the task.
 */
export async function resolveTaskIdOnly(options: {
  task_id?: number | null;
  ticket_number?: string | null;
  unique_index?: number | null;
  project_id?: number | null;
}): Promise<number | null> {
  const { task_id, ticket_number, unique_index, project_id } = options;

  if (task_id) {
    if (!project_id) return task_id;
    const task = await prisma.task.findFirst({
      where: { id: task_id, projectId: project_id, status: { not: 'Deleted' } },
      select: { id: true },
    });
    return task?.id ?? null;
  }

  if (ticket_number) {
    const tasks = await prisma.task.findMany({
      where: {
        ticketNumber: ticket_number,
        status: { not: 'Deleted' },
        ...(project_id ? { projectId: project_id } : {}),
      },
      select: { id: true },
      orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
      take: project_id ? 1 : 2,
    });
    if (!project_id && tasks.length > 1) {
      throw new TaskIdentifierAmbiguityError(ticket_number);
    }
    if (!tasks.length) tasks.push(...await findPrefixAliasTasks(ticket_number, {}, project_id));
    if (!project_id && tasks.length > 1) throw new TaskIdentifierAmbiguityError(ticket_number);
    return tasks[0]?.id ?? null;
  }

  if (unique_index != null && project_id != null) {
    const task = await prisma.task.findFirst({
      where: {
        projectId: project_id,
        uniqueIndex: unique_index,
        status: { not: 'Deleted' },
      },
      select: { id: true },
    });
    return task?.id ?? null;
  }

  return null;
}

export async function findTaskByStringIdentifier(
  user: { id: number },
  identifier: string,
  agentId?: string | null
) {
  const task = identifier.trim();
  if (!task) return null;

  if (/^[A-Za-z][A-Za-z0-9_-]*-\d+$/.test(task)) {
    return findTaskByIdentifier(
      user,
      { ticket_number: task.toUpperCase() },
      agentId
    );
  }

  const numericIdentifier = Number(task);
  if (!Number.isInteger(numericIdentifier) || numericIdentifier <= 0) return null;

  const matches = await prisma.task.findMany({
    where: {
      OR: [{ id: numericIdentifier }, { uniqueIndex: numericIdentifier }],
      status: { not: 'Deleted' },
      project: getProjectWhere(user.id, agentId),
    },
    select: { id: true, projectId: true, uniqueIndex: true },
  });
  const uniqueIndexMatches = matches.filter(
    (match) => match.uniqueIndex === numericIdentifier
  );

  if (uniqueIndexMatches.length === 1) return uniqueIndexMatches[0];
  return matches.find((match) => match.id === numericIdentifier) ?? null;
}

export function validateTaskIdentifier(params: {
  task_id?: number | null;
  ticket_number?: string | null;
  unique_index?: number | null;
  project_id?: number | null;
}):
  | {
      valid: true;
      error?: never;
      code?: never;
      field?: never;
    }
  | {
      valid: false;
      error: string;
      code: 'missing_field' | 'invalid_field';
      field: string;
    } {
  const { task_id, ticket_number, unique_index, project_id } = params;
  const methodCount = [!!task_id, !!ticket_number, !!unique_index].filter(Boolean).length;

  if (methodCount === 0) {
    return {
      valid: false,
      error: 'Either task_id, ticket_number, or (project_id + unique_index) must be provided',
      code: 'missing_field',
      field: 'task_id/ticket_number',
    };
  }

  if (methodCount > 1) {
    return {
      valid: false,
      error: 'Provide only one of task_id, ticket_number, or (project_id + unique_index)',
      code: 'invalid_field',
      field: 'task_id/ticket_number',
    };
  }

  if (unique_index != null && (project_id == null || project_id === undefined)) {
    return {
      valid: false,
      error: 'project_id is required when using unique_index',
      code: 'missing_field',
      field: 'project_id',
    };
  }

  return { valid: true };
}
