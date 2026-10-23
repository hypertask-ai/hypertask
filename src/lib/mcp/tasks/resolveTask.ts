import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { findIdParamOutOfRange, idOutOfRangeMessage } from '@/lib/mcp/listParams';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { HTPR_6868_TICKET_PREFIX_FLAG, isFeatureEnabled } from '@/lib/flags';
import { findPrefixAliasTasks } from '@/utils/controllers/projects/findPrefixAliasTasks';
import { getProjectWhere, intersectProjectTeamScope } from '@/utils/controllers/projects/getAllIncludes';

export class TaskIdentifierAmbiguityError extends Error {
  readonly status = 400;
  readonly code = 'ambiguous_ticket_number';

  constructor(ticketNumber: string) {
    super(`Ticket number ${ticketNumber} is ambiguous across accessible projects; provide project_id.`);
    this.name = 'TaskIdentifierAmbiguityError';
  }
}

export class TaskIdentifierOutOfRangeError extends Error {
  readonly status = 400;
  readonly code = 'invalid_field';

  constructor(readonly field: string) {
    super(idOutOfRangeMessage(field));
    this.name = 'TaskIdentifierOutOfRangeError';
  }
}

export function taskIdentifierErrorResponse(error: unknown, field?: string): Response | null {
  if (!(error instanceof TaskIdentifierAmbiguityError) && !(error instanceof TaskIdentifierOutOfRangeError)) return null;
  return Response.json(
    {
      success: false,
      error: error.message,
      code: error.code,
      ...(field ? { field: error instanceof TaskIdentifierOutOfRangeError ? error.field : field } : {}),
    },
    { status: error.status }
  );
}

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
  teamScope?: AgentTokenTeamScope | null,
) {
  const { task_id, ticket_number, unique_index, project_id } = options;
  const outOfRange = findIdParamOutOfRange({ task_id, unique_index, project_id });
  if (outOfRange) throw new TaskIdentifierOutOfRangeError(outOfRange);
  const projectFilter = intersectProjectTeamScope(projectAccess ?? getProjectWhere(user.id, agentId), teamScope);

  if (task_id) {
    const task = await prisma.task.findFirst({
      where: {
        id: task_id,
        ...(project_id ? { projectId: project_id } : {}),
        status: { not: 'Deleted' },
        project: projectFilter,
      },
      select: { id: true, projectId: true },
    });
    if (task) recordAgentBoardScopeMiss(task.projectId);
    return task;
  }

  if (!ticket_number && (unique_index == null || project_id == null)) return null;

  const identityWhere = ticket_number
    ? { ticketNumber: { equals: ticket_number, mode: 'insensitive' as const }, ...(project_id ? { projectId: project_id } : {}) }
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
  if (matches.length) {
    recordAgentBoardScopeMiss(matches[0].projectId);
    return matches[0];
  }

  const liveTask = await prisma.task.findFirst({
    where: { ...identityWhere, status: { not: 'Deleted' } },
    select: { id: true },
  });
  if (liveTask) return null;

  const aliases = await prisma.taskNumberAlias.findMany({
    where: {
      ...identityWhere,
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
  const prefixTasks = ticket_number && await isFeatureEnabled(HTPR_6868_TICKET_PREFIX_FLAG, user.id)
    ? await findPrefixAliasTasks(ticket_number, projectFilter, project_id)
    : [];
  const tasks = [...new Map([
    ...availableAliases.map(({ task }) => task),
    ...prefixTasks,
  ].map(task => [task.id, task])).values()];
  if (!project_id && tasks.length > 1) {
    throw new TaskIdentifierAmbiguityError(ticket_number!);
  }
  if (tasks[0]) recordAgentBoardScopeMiss(tasks[0].projectId);
  return tasks[0] ?? null;
}

export async function resolveTaskIdOnly(options: {
  task_id?: number | null;
  ticket_number?: string | null;
  unique_index?: number | null;
  project_id?: number | null;
}): Promise<number | null> {
  const { task_id, ticket_number, unique_index, project_id } = options;
  const outOfRange = findIdParamOutOfRange({ task_id, unique_index, project_id });
  if (outOfRange) throw new TaskIdentifierOutOfRangeError(outOfRange);

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
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
) {
  const task = identifier.trim();
  if (!task) return null;

  if (/^[A-Za-z][A-Za-z0-9_-]*-\d+$/.test(task)) {
    return findTaskByIdentifier(
      user,
      { ticket_number: task.toUpperCase() },
      agentId, undefined, teamScope
    );
  }

  const numericIdentifier = Number(task);
  if (findIdParamOutOfRange({ task: numericIdentifier })) throw new TaskIdentifierOutOfRangeError('task');
  if (!Number.isInteger(numericIdentifier) || numericIdentifier <= 0) return null;

  const matches = await prisma.task.findMany({
    where: {
      OR: [{ id: numericIdentifier }, { uniqueIndex: numericIdentifier }],
      status: { not: 'Deleted' },
      project: getProjectWhere(user.id, agentId, teamScope),
    },
    select: { id: true, projectId: true, uniqueIndex: true },
  });
  const uniqueIndexMatches = matches.filter(
    (match) => match.uniqueIndex === numericIdentifier
  );

  const resolved = uniqueIndexMatches.length === 1 ? uniqueIndexMatches[0] : matches.find((match) => match.id === numericIdentifier);
  if (resolved) recordAgentBoardScopeMiss(resolved.projectId);
  return resolved ?? null;
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
