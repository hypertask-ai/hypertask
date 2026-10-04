import type { DecisionRequest } from '@prisma/client'
import { DecisionRequestStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { findTaskByIdentifier, validateTaskIdentifier } from '@/lib/mcp/tasks/resolveTask'
import prisma from '@/lib/prisma'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import { sanitizeRichHtml } from '@/utils/helperFunctions/sanitizeRichHtml'

const MAX_QUESTION_LENGTH = 2000
const MIN_OPTIONS = 2
const MAX_OPTIONS = 10
const MAX_OPTION_LENGTH = 200

function validationError(message: string, field?: string) {
  return NextResponse.json(
    { success: false, error: message, code: 'invalid_field', ...(field ? { field } : {}) },
    { status: 400 }
  )
}

const idFor = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null

const queryIdFor = (value: string | null): number | null =>
  value !== null && /^\d+$/.test(value) ? idFor(Number(value)) : null

const ticketFor = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

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

function decisionCommentHtml(question: string, options: string[]) {
  const optionItems = options.map((option) => `<li>${option}</li>`).join('')
  return sanitizeRichHtml(
    `<p><strong>Decision needed:</strong> ${question}</p>` +
      `<ol>${optionItems}</ol>` +
      '<p>Reply with your choice, or this will be answerable from the UI soon.</p>'
  )
}

function parseStatus(value: string | null): DecisionRequestStatus | null | undefined {
  if (value === null) return undefined

  const normalized = value.trim().toLowerCase()
  if (normalized === 'pending') return DecisionRequestStatus.Pending
  if (normalized === 'answered') return DecisionRequestStatus.Answered
  if (normalized === 'cancelled') return DecisionRequestStatus.Cancelled
  return null
}

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

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

    const taskId = idFor(body.task_id)
    const ticketNumber = ticketFor(body.ticket_number)
    const projectId = idFor(body.project_id)
    const uniqueIndex = idFor(body.unique_index)
    const identifierValidation = validateTaskIdentifier({
      task_id: taskId,
      ticket_number: ticketNumber,
      project_id: projectId,
      unique_index: uniqueIndex,
    })
    if (!identifierValidation.valid) {
      return validationError(identifierValidation.error, identifierValidation.field)
    }

    if (typeof body.question !== 'string' || body.question.trim() === '') {
      return validationError('question is required', 'question')
    }
    const question = body.question.trim()
    if (question.length > MAX_QUESTION_LENGTH) {
      return validationError(
        `question may be at most ${MAX_QUESTION_LENGTH} characters`,
        'question'
      )
    }

    if (!Array.isArray(body.options)) {
      return validationError('options must be an array of strings', 'options')
    }
    if (body.options.length < MIN_OPTIONS || body.options.length > MAX_OPTIONS) {
      return validationError(
        `options must contain between ${MIN_OPTIONS} and ${MAX_OPTIONS} items`,
        'options'
      )
    }

    const options: string[] = []
    for (const option of body.options) {
      if (typeof option !== 'string' || option.trim() === '') {
        return validationError('each option must be a non-empty string', 'options')
      }
      const trimmedOption = option.trim()
      if (trimmedOption.length > MAX_OPTION_LENGTH) {
        return validationError(
          `each option may be at most ${MAX_OPTION_LENGTH} characters`,
          'options'
        )
      }
      options.push(trimmedOption)
    }
    if (new Set(options).size !== options.length) {
      return validationError('options must not contain duplicates', 'options')
    }

    const task = await findTaskByIdentifier(
      ctx.user,
      {
        task_id: taskId,
        ticket_number: ticketNumber,
        project_id: projectId,
        unique_index: uniqueIndex,
      },
      ctx.agentId
    )
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    const [taskOwner, currentUser] = await Promise.all([
      prisma.task.findUnique({ where: { id: task.id }, select: { userId: true } }),
      prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { id: true, email: true, displayName: true, photoURL: true },
      }),
    ])
    if (!taskOwner || !currentUser) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    const decisionRequest = await prisma.decisionRequest.create({
      data: {
        taskId: task.id,
        question,
        options,
        status: DecisionRequestStatus.Pending,
        createdById: ctx.user.id,
        agentId: ctx.agentId ?? null,
      },
    })

    const comment = await createCommentService({
      text: decisionCommentHtml(question, options),
      creatorId: ctx.user.id,
      taskId: task.id,
      ownerId: taskOwner.userId,
      currentUser,
      agentId: ctx.agentId ?? undefined,
    })

    const savedDecisionRequest = await prisma.decisionRequest.update({
      where: { id: decisionRequest.id },
      data: { commentId: comment.id },
    })

    return NextResponse.json(
      {
        success: true,
        decision_request: mapDecisionRequest(savedDecisionRequest),
        comment_id: comment.id,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[MCP Decision Request POST] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const taskIdValue = searchParams.get('task_id')
    const projectIdValue = searchParams.get('project_id')
    const uniqueIndexValue = searchParams.get('unique_index')
    const taskId = queryIdFor(taskIdValue)
    const projectId = queryIdFor(projectIdValue)
    const uniqueIndex = queryIdFor(uniqueIndexValue)
    const ticketNumber = ticketFor(searchParams.get('ticket_number'))

    if (taskIdValue !== null && taskId === null) {
      return validationError('task_id must be a positive integer', 'task_id')
    }
    if (projectIdValue !== null && projectId === null) {
      return validationError('project_id must be a positive integer', 'project_id')
    }
    if (uniqueIndexValue !== null && uniqueIndex === null) {
      return validationError('unique_index must be a positive integer', 'unique_index')
    }

    const identifierValidation = validateTaskIdentifier({
      task_id: taskId,
      ticket_number: ticketNumber,
      project_id: projectId,
      unique_index: uniqueIndex,
    })
    if (!identifierValidation.valid) {
      return validationError(identifierValidation.error, identifierValidation.field)
    }

    const status = parseStatus(searchParams.get('status'))
    if (status === null) {
      return validationError('status must be pending, answered, or cancelled', 'status')
    }

    const task = await findTaskByIdentifier(
      ctx.user,
      {
        task_id: taskId,
        ticket_number: ticketNumber,
        project_id: projectId,
        unique_index: uniqueIndex,
      },
      ctx.agentId
    )
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    const decisionRequests = await prisma.decisionRequest.findMany({
      where: {
        taskId: task.id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      decision_requests: decisionRequests.map(mapDecisionRequest),
    })
  } catch (error) {
    console.error('[MCP Decision Request GET] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
