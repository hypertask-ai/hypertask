import type { DecisionRequest } from '@prisma/client'
import { DecisionRequestStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import prisma from '@/lib/prisma'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import { sanitizeRichHtml } from '@/utils/helperFunctions/sanitizeRichHtml'

function validationError(message: string, field?: string) {
  return NextResponse.json(
    { success: false, error: message, code: 'invalid_field', ...(field ? { field } : {}) },
    { status: 400 }
  )
}

function mapDecisionRequest(row: DecisionRequest) {
  return {
    id: row.id,
    taskId: row.taskId,
    question: row.question,
    options: row.options,
    status: row.status.toLowerCase(),
    answer: row.answer,
    answerNote: row.answerNote,
    createdAt: row.createdAt,
    answeredAt: row.answeredAt,
    commentId: row.commentId,
  }
}

function routeIdFor(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function optionsFor(decisionRequest: DecisionRequest): string[] {
  if (!Array.isArray(decisionRequest.options)) return []
  return decisionRequest.options.filter((option): option is string => typeof option === 'string')
}

function answeredCommentHtml(selectedOption: string, note: string | null) {
  return sanitizeRichHtml(
    `<p><strong>Answered:</strong> ${selectedOption}</p>` +
      (note ? `<p>${note}</p>` : '')
  )
}

async function loadAccessibleDecisionRequest(
  request: NextRequest,
  idValue: string
): Promise<
  | { response: NextResponse; decisionRequest?: never; ctx?: never }
  | {
      response?: never
      decisionRequest: DecisionRequest
      ctx: NonNullable<Awaited<ReturnType<typeof validateMcpAuth>>>
    }
> {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return { response: rateLimited }

  const ctx = await validateMcpAuth(request)
  if (!ctx) {
    return {
      response: NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      ),
    }
  }

  const id = routeIdFor(idValue)
  if (id === null) {
    return { response: validationError('id must be a positive integer', 'id') }
  }

  const decisionRequest = await prisma.decisionRequest.findUnique({ where: { id } })
  if (!decisionRequest) {
    return {
      response: NextResponse.json(
        { success: false, error: 'Decision request not found' },
        { status: 404 }
      ),
    }
  }

  const task = await findTaskByIdentifier(
    ctx.user,
    { task_id: decisionRequest.taskId },
    ctx.agentId
  )
  if (!task) {
    return {
      response: NextResponse.json(
        { success: false, error: 'Decision request not found' },
        { status: 404 }
      ),
    }
  }

  return { decisionRequest, ctx }
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params
    const loaded = await loadAccessibleDecisionRequest(request, params.id)
    if (loaded.response) return loaded.response

    return NextResponse.json({
      success: true,
      decision_request: mapDecisionRequest(loaded.decisionRequest),
    })
  } catch (error) {
    console.error('[MCP Decision Request GET by ID] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params
    const loaded = await loadAccessibleDecisionRequest(request, params.id)
    if (loaded.response) return loaded.response

    const { ctx, decisionRequest } = loaded

    let body: Record<string, unknown>
    try {
      const parsed = await request.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return validationError('Request body must be a JSON object')
      }
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }

    if (decisionRequest.status !== DecisionRequestStatus.Pending) {
      return NextResponse.json(
        {
          success: false,
          error: `Decision request is already ${decisionRequest.status.toLowerCase()}`,
        },
        { status: 409 }
      )
    }

    if (body.action !== 'answer' && body.action !== 'cancel') {
      return validationError('action must be answer or cancel', 'action')
    }

    if (body.action === 'answer') {
      if (ctx.agentId) {
        return NextResponse.json(
          { success: false, error: 'Only a human user can answer a decision request' },
          { status: 403 }
        )
      }

      if (typeof body.selected_option !== 'string' || body.selected_option.trim() === '') {
        return validationError('selected_option is required', 'selected_option')
      }

      const validOptions = optionsFor(decisionRequest)
      const selectedOption = body.selected_option.trim()
      const matchingOption = validOptions.find((option) => option.trim() === selectedOption)
      if (!matchingOption) {
        return validationError(
          `selected_option must match one of: ${validOptions.join(', ')}`,
          'selected_option'
        )
      }

      let note: string | null = null
      if (body.note !== undefined && body.note !== null) {
        if (typeof body.note !== 'string') {
          return validationError('note must be a string', 'note')
        }
        note = body.note.trim()
      }

      const [taskOwner, currentUser] = await Promise.all([
        prisma.task.findUnique({
          where: { id: decisionRequest.taskId },
          select: { userId: true },
        }),
        prisma.user.findUnique({
          where: { id: ctx.user.id },
          select: { id: true, email: true, displayName: true, photoURL: true },
        }),
      ])
      if (!taskOwner || !currentUser) {
        return NextResponse.json(
          { success: false, error: 'Decision request not found' },
          { status: 404 }
        )
      }

      const answeredDecisionRequest = await prisma.decisionRequest.update({
        where: { id: decisionRequest.id },
        data: {
          status: DecisionRequestStatus.Answered,
          answer: matchingOption,
          answerNote: note,
          answeredById: ctx.user.id,
          answeredAt: new Date(),
        },
      })

      await createCommentService({
        text: answeredCommentHtml(matchingOption, note),
        creatorId: ctx.user.id,
        taskId: decisionRequest.taskId,
        ownerId: taskOwner.userId,
        currentUser,
      })

      return NextResponse.json({
        success: true,
        decision_request: mapDecisionRequest(answeredDecisionRequest),
      })
    }

    const taskOwner = await prisma.task.findUnique({
      where: { id: decisionRequest.taskId },
      select: { userId: true },
    })
    if (!taskOwner) {
      return NextResponse.json(
        { success: false, error: 'Decision request not found' },
        { status: 404 }
      )
    }

    const canCancel = ctx.agentId !== null
      ? ctx.agentId === decisionRequest.agentId
      : ctx.user.id === decisionRequest.createdById ||
        ctx.user.id === taskOwner.userId
    if (!canCancel) {
      return NextResponse.json(
        { success: false, error: 'You are not allowed to cancel this decision request' },
        { status: 403 }
      )
    }

    const cancelledDecisionRequest = await prisma.decisionRequest.update({
      where: { id: decisionRequest.id },
      data: { status: DecisionRequestStatus.Cancelled },
    })

    return NextResponse.json({
      success: true,
      decision_request: mapDecisionRequest(cancelledDecisionRequest),
    })
  } catch (error) {
    console.error('[MCP Decision Request PATCH] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
