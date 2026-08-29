import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import { setTaskMovedToInboxState } from '@/lib/taskCardActions/inboxState'
import { withTaskStarWriteLock } from '@/lib/taskCardActions/writeLocks'

type CardAction = 'star' | 'inbox'

type AuthContext = NonNullable<Awaited<ReturnType<typeof validateMcpAuth>>>

type CardActionState = {
  active: boolean
  saved_content?: Array<{ id: string; type: 'Private' }>
}

type CardActionDependencies = {
  checkRateLimit: typeof checkMcpRateLimit
  validateAuth: typeof validateMcpAuth
  findTask: (ctx: AuthContext, taskId: number) => Promise<{ id: number; projectId: number } | null>
  setStarred: (userId: number, taskId: number, projectId: number, active: boolean) => Promise<CardActionState>
  setInbox: (ctx: AuthContext, taskId: number, projectId: number, active: boolean) => Promise<CardActionState>
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null
}

function invalid(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 })
}

const defaultDependencies: CardActionDependencies = {
  checkRateLimit: checkMcpRateLimit,
  validateAuth: validateMcpAuth,
  findTask: async (ctx, taskId) =>
    findTaskByIdentifier(ctx.user, { task_id: taskId }, ctx.agentId),
  setStarred: async (userId, taskId, projectId, active) => {
    const savedContent = await withTaskStarWriteLock(taskId, async (tx) => {
      const lockedTask = await tx.$queryRaw<Array<{ projectId: number }>>`
        SELECT "projectId"
        FROM "Task"
        WHERE id = ${taskId} AND status <> 'Deleted'
        FOR UPDATE
      `
      if (lockedTask[0]?.projectId !== projectId) {
        throw new Error('Task changed boards before star reconciliation')
      }
      const identity = { userId, taskId, commentId: null, type: 'Private' as const }
      if (active) {
        const existing = await tx.savedContent.findFirst({
          where: identity,
          select: { id: true },
        })
        if (existing) {
          await tx.savedContent.updateMany({
            where: identity,
            data: { projectId },
          })
        } else {
          await tx.savedContent.create({
            data: { userId, taskId, projectId, commentId: null, type: 'Private' },
          })
        }
      } else {
        await tx.savedContent.deleteMany({
          where: identity,
        })
      }

      return tx.savedContent.findMany({
        where: identity,
        select: { id: true, type: true },
        take: 1,
      })
    })
    return {
      active: savedContent.length > 0,
      saved_content: savedContent.map((item) => ({
        id: item.id,
        type: 'Private' as const,
      })),
    }
  },
  setInbox: async (ctx, taskId, projectId, active) => {
    const recipient = {
      userId: ctx.user.id,
      agentId: ctx.agentId ?? null,
      taskId,
      projectId,
      fromUserId: ctx.user.id,
      fromAgentId: ctx.agentId ?? null,
    }
    const activeAfterWrite = await setTaskMovedToInboxState(recipient, active)
    return { active: activeAfterWrite }
  },
}

export function createTaskCardActionHandler(
  dependencies: CardActionDependencies = defaultDependencies,
) {
  return async function POST(request: NextRequest) {
    const rateLimited = await dependencies.checkRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await dependencies.validateAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 },
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return invalid('Request body must be valid JSON')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return invalid('Request body must be a JSON object')
    }

    const input = body as Record<string, unknown>
    const taskId = positiveInteger(input.task_id)
    const projectId = positiveInteger(input.project_id)
    const action = input.action
    if (!taskId) return invalid('task_id must be a positive integer')
    if (!projectId) return invalid('project_id must be a positive integer')
    if (action !== 'star' && action !== 'inbox') {
      return invalid("action must be either 'star' or 'inbox'")
    }
    if (typeof input.active !== 'boolean') {
      return invalid('active must be a boolean')
    }
    if (action === 'star' && ctx.agentId) {
      return NextResponse.json(
        { success: false, error: 'Private task stars are available only to human accounts' },
        { status: 403 },
      )
    }

    const task = await dependencies.findTask(ctx, taskId)
    if (!task || task.projectId !== projectId) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 },
      )
    }

    try {
      const state = action === 'star'
        ? await dependencies.setStarred(ctx.user.id, task.id, projectId, input.active)
        : await dependencies.setInbox(ctx, task.id, projectId, input.active)
      return NextResponse.json(
        { success: true, action: action as CardAction, ...state },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    } catch (error) {
      console.error('[MCP Task Card Action]', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update task card action' },
        { status: 500 },
      )
    }
  }
}

export const POST = createTaskCardActionHandler()
