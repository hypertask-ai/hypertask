import { RefusalError } from '@/lib/api/refusal'
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { findIdParamOutOfRange, idOutOfRangeMessage } from '@/lib/mcp/listParams';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { HTPR_6868_TICKET_PREFIX_FLAG, isFeatureEnabled } from '@/lib/flags';
import { findPrefixAliasTasks } from '@/utils/controllers/projects/findPrefixAliasTasks';
import { getProjectWhere, intersectProjectTeamScope } from '@/utils/controllers/projects/getAllIncludes';

export const TICKET_NUMBER_CANDIDATE_LIMIT = 8;
export const TICKET_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*-\d+$/;
export type ReusedTicketKeyCollision = { requestedKey: string; liveTaskId: number; liveTicketNumber: string | null; movedTaskId: number; movedTicketNumber: string | null; movedProjectId: number; movedUniqueIndex: number; message: string };

export function parseTaskStringReference(value: string): { project_id: number; unique_index: number } | null {
  const m = /(?:https?:\/\/)?(?:app\.)?hypertask\.ai\/detail\/project-(\d+)\/(\d+)/i.exec(value.trim()) ?? /^(?:PROJECT-)?(\d+)-(\d+)$/i.exec(value.trim());
  const project_id = m ? Number(m[1]) : 0;
  const unique_index = m ? Number(m[2]) : 0;
  return Number.isSafeInteger(project_id) && project_id > 0 && Number.isSafeInteger(unique_index) && unique_index > 0 ? { project_id, unique_index } : null;
}

const LIKE_WILDCARD = /[\\%_]/;

export const needsIlikeSemantics = (ticketNumber: string) => LIKE_WILDCARD.test(ticketNumber);

const runTicketNumberCandidates = async (
  query: () => Promise<{ id: number }[]>,
): Promise<number[] | null> => {
  try {
    const rows = await query();
    return rows.map((row) => row.id);
  } catch {
    return null;
  }
};

export const caseInsensitiveTicketNumberCandidates = (ticketNumber: string): Promise<number[] | null> =>
  runTicketNumberCandidates(() =>
    needsIlikeSemantics(ticketNumber)
      ? prisma.$queryRaw<{ id: number }[]>`
          SELECT id FROM "Task"
          WHERE "ticketNumber" ILIKE ${ticketNumber}
          ORDER BY "projectId" ASC, id ASC
          LIMIT ${TICKET_NUMBER_CANDIDATE_LIMIT + 1}
        `
      : prisma.$queryRaw<{ id: number }[]>`
          SELECT id FROM "Task"
          WHERE lower("ticketNumber") = lower(${ticketNumber})
          ORDER BY "projectId" ASC, id ASC
          LIMIT ${TICKET_NUMBER_CANDIDATE_LIMIT + 1}
        `,
  );

export const materializedTicketNumberCandidates = (ticketNumber: string): Promise<number[] | null> =>
  needsIlikeSemantics(ticketNumber)
    ? caseInsensitiveTicketNumberCandidates(ticketNumber)
    : runTicketNumberCandidates(() =>
        prisma.$queryRaw<{ id: number }[]>`
          WITH indexed_matches AS MATERIALIZED (
            SELECT id, "projectId" FROM "Task"
            WHERE lower("ticketNumber") = lower(${ticketNumber})
          )
          SELECT id FROM indexed_matches
          ORDER BY "projectId" ASC, id ASC
          LIMIT ${TICKET_NUMBER_CANDIDATE_LIMIT + 1}
        `,
      );

export class TaskIdentifierAmbiguityError extends RefusalError {
  readonly status = 400;
  readonly code = 'ambiguous_ticket_number';

  constructor(ticketNumber: string) {
    super({ status: 400, reason: 'invalid_field', field: 'ticket_number', message: `Ticket number ${ticketNumber} is ambiguous across accessible projects; provide project_id.` });
    this.name = 'TaskIdentifierAmbiguityError';
  }
}

export class TaskIdentifierOutOfRangeError extends RefusalError {
  readonly status = 400;
  readonly code = 'invalid_field';

  constructor(readonly field: string) {
    super({ status: 400, reason: 'invalid_field', field, message: idOutOfRangeMessage(field) });
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
  const findMatches = (where: Prisma.TaskWhereInput) =>
    prisma.task.findMany({
      where,
      select: { id: true, projectId: true },
      orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
      take: project_id ? 1 : 2,
    });
  let matches: { id: number; projectId: number }[] = [];
  let indexedMiss = false;
  const scope = { status: { not: 'Deleted' as const }, project: projectFilter };
  if (ticket_number && await isFeatureEnabled("htpr-8977-indexed-ticket-lookup", user.id)) {
    const candidates = await isFeatureEnabled("htpr-8977-materialized-ticket-lookup", user.id)
      ? await materializedTicketNumberCandidates(ticket_number)
      : await caseInsensitiveTicketNumberCandidates(ticket_number);
    indexedMiss = candidates != null && candidates.length === 0;
    matches = indexedMiss
      ? []
      : candidates != null && candidates.length <= TICKET_NUMBER_CANDIDATE_LIMIT
        ? await findMatches({ id: { in: candidates }, ...identityWhere, ...scope })
        : await findMatches({ ...identityWhere, ...scope });
  } else {
    matches = await findMatches({ ...identityWhere, ...scope });
  }
  if (!project_id && matches.length > 1) {
    throw new TaskIdentifierAmbiguityError(ticket_number!);
  }
  if (matches.length) {
    recordAgentBoardScopeMiss(matches[0].projectId);
    return matches[0];
  }

  if (!indexedMiss) {
    const liveTask = await prisma.task.findFirst({
      where: { ...identityWhere, status: { not: 'Deleted' } },
      select: { id: true },
    });
    if (liveTask) return null;
  }

  const aliases = await prisma.taskNumberAlias.findMany({
    where: {
      ...identityWhere,
      task: { status: { not: 'Deleted' }, project: projectFilter },
    },
    select: { projectId: true, uniqueIndex: true, task: { select: { id: true, projectId: true } } },
    orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
  });
  if (!aliases.length && ticket_number && prisma.project?.findMany) {
    const keyMatch = /^([A-Za-z][A-Za-z0-9_-]*)-(\d+)$/.exec(ticket_number.trim());
    const idx = keyMatch ? Number(keyMatch[2]) : 0;
    const boards = keyMatch && Number.isSafeInteger(idx) && idx > 0 && !findIdParamOutOfRange({ unique_index: idx }) ? await prisma.project.findMany({ where: { uniqueIdentifier: { equals: keyMatch[1].toUpperCase(), mode: 'insensitive' }, status: { not: 'Deleted' }, ...(project_id ? { id: project_id } : {}) }, select: { id: true } }) : [];
    if (boards.length) aliases.push(...await prisma.taskNumberAlias.findMany({ where: { projectId: { in: boards.map((b) => b.id) }, uniqueIndex: idx, task: { status: { not: 'Deleted' }, project: projectFilter } }, select: { projectId: true, uniqueIndex: true, task: { select: { id: true, projectId: true } } }, orderBy: [{ projectId: 'asc' }, { id: 'asc' }] }));
  }
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

export async function findReusedKeyCollisions(
  user: { id: number },
  liveTasks: ReadonlyArray<{ id: number; projectId?: number | null; uniqueIndex?: number | null; ticketNumber?: string | null }>,
  requested: { ticketNumbers?: ReadonlyArray<string> | null; uniqueIndex?: number | null; projectId?: number | null },
  agentId?: string | null, projectAccess?: Prisma.ProjectWhereInput, teamScope?: AgentTokenTeamScope | null,
): Promise<ReusedTicketKeyCollision[]> {
  if (!liveTasks.length || !prisma.taskNumberAlias?.findMany) return [];
  const orWhere: Prisma.TaskNumberAliasWhereInput[] = (requested.ticketNumbers ?? []).map((v) => v.trim()).filter(Boolean)
    .map((ticket) => ({ ticketNumber: { equals: ticket, mode: 'insensitive' }, ...(requested.projectId ? { projectId: requested.projectId } : {}) }));
  if (requested.uniqueIndex != null && requested.projectId != null) orWhere.push({ projectId: requested.projectId, uniqueIndex: requested.uniqueIndex });
  if (!orWhere.length) return [];
  const projectFilter = intersectProjectTeamScope(projectAccess ?? getProjectWhere(user.id, agentId), teamScope);
  const liveIds = new Set(liveTasks.map((t) => t.id));
  const aliases = await prisma.taskNumberAlias.findMany({ where: { OR: orWhere, task: { status: { not: 'Deleted' }, project: projectFilter } }, select: { projectId: true, uniqueIndex: true, ticketNumber: true, task: { select: { id: true, projectId: true, uniqueIndex: true, ticketNumber: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const seen = new Set<string>();
  return aliases.flatMap((a) => {
    const live = a.task && !liveIds.has(a.task.id) ? liveTasks.find((t) => (t.projectId === a.projectId && t.uniqueIndex === a.uniqueIndex) || (a.ticketNumber && t.ticketNumber?.toLowerCase() === a.ticketNumber.toLowerCase())) : undefined;
    const key = a.ticketNumber ?? `project-${a.projectId}/${a.uniqueIndex}`;
    const dedupe = `${key.toLowerCase()}:${a.task?.id}`;
    if (!a.task || !live || seen.has(dedupe)) return [];
    seen.add(dedupe);
    return [{ requestedKey: key, liveTaskId: live.id, liveTicketNumber: live.ticketNumber ?? null, movedTaskId: a.task.id, movedTicketNumber: a.task.ticketNumber ?? null, movedProjectId: a.task.projectId, movedUniqueIndex: a.task.uniqueIndex, message: `Key ${key} was reused after a board move; returning live task ${live.ticketNumber ?? `project-${a.projectId}/${a.uniqueIndex}`}. Moved ticket is now ${a.task.ticketNumber ?? `project-${a.task.projectId}/${a.task.uniqueIndex}`} (board ${a.task.projectId}, task ${a.task.id}).` }];
  });
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
    if (tasks[0]) return tasks[0].id;
    const aliases = prisma.taskNumberAlias?.findMany ? await prisma.taskNumberAlias.findMany({ where: { ticketNumber: { equals: ticket_number, mode: 'insensitive' }, ...(project_id ? { projectId: project_id } : {}), task: { status: { not: 'Deleted' } } }, select: { projectId: true, uniqueIndex: true, taskId: true }, orderBy: [{ projectId: 'asc' }, { id: 'asc' }] }) : [];
    const reused = aliases.length ? await prisma.task.findMany({ where: { OR: aliases.map(({ projectId, uniqueIndex }) => ({ projectId, uniqueIndex })), status: { not: 'Deleted' } }, select: { projectId: true, uniqueIndex: true } }) : [];
    const ids = [...new Set(aliases.filter((a) => !reused.some((t) => t.projectId === a.projectId && t.uniqueIndex === a.uniqueIndex)).map((a) => a.taskId))];
    if (!project_id && ids.length > 1) throw new TaskIdentifierAmbiguityError(ticket_number);
    return ids[0] ?? null;
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
    if (task) return task.id;
    const alias = prisma.taskNumberAlias?.findUnique
      ? await prisma.taskNumberAlias.findUnique({ where: { projectId_uniqueIndex: { projectId: project_id, uniqueIndex: unique_index } }, select: { task: { select: { id: true, status: true } } } })
      : null;
    return alias?.task && alias.task.status !== 'Deleted' ? alias.task.id : null;
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

  const boardRef = parseTaskStringReference(task);
  if (boardRef) return findTaskByIdentifier(user, boardRef, agentId, undefined, teamScope);

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
