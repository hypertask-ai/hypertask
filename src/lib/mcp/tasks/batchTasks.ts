import { NextRequest, NextResponse } from 'next/server'
import type { McpAuthContext } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import {
  mapTaskToMcpGetResponse,
  taskMcpGetInclude,
} from '@/lib/mcp/tasks/mappers'
import {
  executeTaskUpdate,
  type TaskClearAssigneesHandler,
  type TaskUpdateAssigneeHandler,
  type UpdateTaskBody,
} from '@/lib/mcp/tasks/updateTask'
import type { TaskDetail } from '@/lib/mcp/tasks/types'
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import type { IUser } from '@/models/model'
import getMemberAndOwner from '@/utils/controllers/getMemberAndOwnerForBoard'
import { requireRole } from '@/lib/mcp/agents/scopes'

const MAX_BATCH_ITEMS = 100

type BatchGetBody = {
  op: 'get'
  task_ids: number[]
}

type BatchUpdateBody = {
  op: 'update'
  updates: UpdateTaskBody[]
}

export type BatchBody = BatchGetBody | BatchUpdateBody

type BatchDependencies = {
  assignAssignees: TaskUpdateAssigneeHandler
  clearAssignees?: TaskClearAssigneesHandler
}

type BatchUpdateSuccess = {
  task_id: number
  success: true
  task: TaskDetail
}

type BatchUpdateError = {
  task_id: number
  success: false
  error: string
  code?: string
  field?: string
  [key: string]: unknown
}

type BatchUpdateResult = BatchUpdateSuccess | BatchUpdateError

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fieldErrorResponse(
  field: string,
  message: string,
  status = 400
) {
  return NextResponse.json(
    buildFieldError('invalid_field', field, message),
    { status }
  )
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

async function assignBatchTaskUsers(input: {
  taskId: number
  projectId: number
  userIds: number[]
  intent: 'assign' | 'unassign'
  user: {
    id: number
    email: string
    displayName: string | null
    photoURL: string | null
  }
  agentId: string | null
}) {
  // Removals skip the membership check: a user who has left the board must
  // still be removable from the task (HTPR-4187).
  const allowedMemberIds =
    input.intent === 'unassign' ? [] : await getMemberAndOwner(input.projectId)
  if (typeof allowedMemberIds === 'string') {
    throw new Error('Could not resolve project members')
  }

  const allowedSet = new Set<number>(allowedMemberIds)
  const invalidUserIds =
    input.intent === 'unassign'
      ? []
      : input.userIds.filter((userId) => !allowedSet.has(userId))
  if (invalidUserIds.length > 0) {
    throw new Error(
      `User(s) ${invalidUserIds.join(', ')} are not members of this project. Only project owner and members can be assigned.`
    )
  }

  const currentUser: IUser = {
    id: input.user.id,
    email: input.user.email,
    displayName: input.user.displayName ?? undefined,
    photoURL: input.user.photoURL ?? undefined,
    uid: '',
    stripe_customer_id: '',
    joinedAt: new Date(),
    UserSettingId: '',
    UserSetting: {} as IUser['UserSetting'],
  }

  const { default: assigneesAssign } = await import(
    '@/utils/controllers/assignees/assign'
  )
  for (const userId of input.userIds) {
    const response = await assigneesAssign(
      currentUser,
      userId,
      input.taskId,
      undefined,
      input.agentId ?? undefined,
      { intent: input.intent }
    )
    if (response.status !== 200) {
      throw new Error(
        (response.json as { message?: string }).message ??
          'Failed to assign users'
      )
    }
  }
}

async function handleBatchGet(
  ctx: McpAuthContext,
  taskIds: number[]
): Promise<NextResponse> {
  if (taskIds.length > MAX_BATCH_ITEMS) {
    return fieldErrorResponse(
      'task_ids',
      `task_ids cannot contain more than ${MAX_BATCH_ITEMS} items`
    )
  }

  if (!taskIds.every(isPositiveInteger)) {
    return fieldErrorResponse(
      'task_ids',
      'task_ids must be an array of positive integers'
    )
  }

  const tasks = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      project: getProjectWhere(ctx.user.id, ctx.agentId),
    },
    include: taskMcpGetInclude(ctx.user.id),
  })

  const tasksById = new Map(
    tasks.map((task) => [
      task.id,
      mapTaskToMcpGetResponse(task, ctx.user.id),
    ])
  )

  return NextResponse.json({
    success: true,
    tasks: taskIds.flatMap((taskId) => {
      const task = tasksById.get(taskId)
      return task ? [task] : []
    }),
    notFound: taskIds.filter((taskId) => !tasksById.has(taskId)),
  })
}

function perItemFieldError(
  taskId: number,
  code: 'invalid_field' | 'missing_field' | 'not_found' | 'forbidden',
  field: string,
  error: string
): BatchUpdateResult {
  const fieldError = buildFieldError(code, field, error)
  return {
    task_id: taskId,
    success: false,
    error: fieldError.error,
    code: fieldError.code,
    field: fieldError.field,
  }
}

async function handleBatchUpdateItem(
  request: NextRequest,
  ctx: McpAuthContext,
  rawUpdate: unknown,
  dependencies: BatchDependencies
): Promise<BatchUpdateResult> {
  const taskId =
    isRecord(rawUpdate) && isPositiveInteger(rawUpdate.task_id)
      ? rawUpdate.task_id
      : 0

  if (!isRecord(rawUpdate)) {
    return perItemFieldError(
      taskId,
      'invalid_field',
      'updates',
      'Each update must be a JSON object'
    )
  }

  if (!isPositiveInteger(rawUpdate.task_id)) {
    return perItemFieldError(
      taskId,
      rawUpdate.task_id === undefined ? 'missing_field' : 'invalid_field',
      'task_id',
      'task_id must be a positive integer'
    )
  }

  if (rawUpdate.dry_run !== undefined) {
    return perItemFieldError(
      taskId,
      'invalid_field',
      'dry_run',
      'dry_run is not supported for batch updates'
    )
  }

  try {
    const execution = await executeTaskUpdate({
      request,
      ctx,
      requestBody: rawUpdate as UpdateTaskBody,
      assignAssignees: dependencies.assignAssignees,
      clearAssignees: dependencies.clearAssignees,
      strictSideEffectFailures: true,
    })
    const body = (await execution.response.json()) as Record<string, unknown>

    if (execution.outcome === 'not_found') {
      return perItemFieldError(
        taskId,
        'not_found',
        'task_id',
        'Task not found or access denied'
      )
    }

    if (
      execution.response.ok &&
      body.success === true &&
      isRecord(body.task)
    ) {
      return {
        task_id: taskId,
        success: true,
        task: body.task as unknown as TaskDetail,
      }
    }

    return {
      ...body,
      task_id: taskId,
      success: false,
      error:
        typeof body.error === 'string'
          ? body.error
          : 'Task update failed',
    } as BatchUpdateError
  } catch (error) {
    console.error(`[MCP Batch Tasks] Failed to update task ${taskId}:`, error)
    return {
      task_id: taskId,
      success: false,
      error: 'Internal server error',
    }
  }
}

async function handleBatchUpdate(
  request: NextRequest,
  ctx: McpAuthContext,
  updates: unknown[],
  dependencies: BatchDependencies
): Promise<NextResponse> {
  if (ctx.agentId) {
    const scopeError = await requireRole(ctx, 'write')
    if (scopeError) return scopeError
  }

  if (updates.length > MAX_BATCH_ITEMS) {
    return fieldErrorResponse(
      'updates',
      `updates cannot contain more than ${MAX_BATCH_ITEMS} items`
    )
  }

  const results = new Array<BatchUpdateResult>(updates.length)
  const taskUpdateTails = new Map<number, Promise<void>>()
  let nextIndex = 0
  const workers = Array.from({ length: 5 }, async () => {
    while (nextIndex < updates.length) {
      const index = nextIndex++
      const update = updates[index]

      const taskId =
        isRecord(update) && isPositiveInteger(update.task_id)
          ? update.task_id
          : null
      const previousUpdate =
        taskId === null
          ? Promise.resolve()
          : taskUpdateTails.get(taskId) ?? Promise.resolve()
      const currentUpdate = previousUpdate.then(async () => {
        results[index] = await handleBatchUpdateItem(
          request,
          ctx,
          update,
          dependencies
        )
      })
      if (taskId !== null) {
        taskUpdateTails.set(
          taskId,
          currentUpdate.then(
            () => undefined,
            () => undefined
          )
        )
      }
      await currentUpdate
    }
  })
  await Promise.all(workers)

  return NextResponse.json({ success: true, results })
}

export async function handleBatchBody(
  request: NextRequest,
  ctx: McpAuthContext,
  body: unknown,
  dependencies: BatchDependencies = {
    assignAssignees: assignBatchTaskUsers,
  }
): Promise<NextResponse> {
  if (!isRecord(body)) {
    return fieldErrorResponse('body', 'Request body must be a JSON object')
  }

  if (body.op === 'get') {
    if (!Array.isArray(body.task_ids)) {
      return fieldErrorResponse(
        'task_ids',
        'task_ids must be an array of positive integers'
      )
    }
    return handleBatchGet(ctx, body.task_ids)
  }

  if (body.op === 'update') {
    if (!Array.isArray(body.updates)) {
      return fieldErrorResponse('updates', 'updates must be an array')
    }
    return handleBatchUpdate(request, ctx, body.updates, dependencies)
  }

  return fieldErrorResponse('op', 'op must be either "get" or "update"')
}
