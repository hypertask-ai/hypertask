import { chatContentScopeWhere } from "@/lib/agents/chatContentScope"
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes"
import { TaskTeamScopeError } from "@/lib/mcp/tasks/agentMutationFence"
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { AGENT_CHAT_SYSTEM_MESSAGES, isAgentChatSystemMessage } from '@/lib/agentRuns/model'
import { broadcastChatSession } from '@/lib/agents/chatBroadcast'
import { listAgentChatActivity } from '@/lib/agents/agentChatActivity'
import { activityContextMessages, asksForAgentActivity } from '@/lib/agents/chatActivityFeed'
import { isFeatureEnabled } from '@/lib/flags'
import { AGENT_CHAT_TICKET_CONFIRM_FLAG } from '@/lib/flags'
import { requireRole } from '@/lib/mcp/agents/scopes'
import { getSectionForTask, validateProjectAccess } from '@/lib/mcp/tasks/services'
import {
  chatTicketProposalSelect,
  parseChatTicketProposal,
  serializeChatTicketProposal,
} from '@/lib/agents/chatTicketProposal'
import { loadAgentTokenChatSession } from '@/lib/agents/chatAccess'
import { HTPR_7734_AGENT_CHAT_CONTEXT_FLAG } from '@/lib/flags/definitions/htpr-7734-agent-chat-context'
import { agentChatContextPayload } from '@/lib/agents/chatContext'

const MAX_MESSAGE_LENGTH = 8000
const TRANSCRIPT_LIMIT = 50
const ACTIVITY_CONTEXT_LIMIT = 10

function requireAgentToken(ctxAgentId: string | null): NextResponse | null {
  if (ctxAgentId) return null
  return NextResponse.json(
    { success: false, error: 'Agent Chat requires an agent token' },
    { status: 403 }
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
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
    const agentGate = requireAgentToken(ctx.agentId)
    if (agentGate) return agentGate
    const tokenAgentId = ctx.agentId as string

    const { sessionId } = await params
    const access = await loadAgentTokenChatSession({
      principal: { userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope },
      sessionId,
      agentId: tokenAgentId,
      select: { userId: true, user: { select: { displayName: true } } },
    })
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      )
    }
    const session = access.session

    const messages = (
      await prisma.chatMessage.findMany({
        where: {
          sessionId: session.id,
          ...(ctx.teamScope != null ? { session: await chatContentScopeWhere({ userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope }) } : {}),
          NOT: { role: 'assistant', isDelivered: false, content: { in: [...AGENT_CHAT_SYSTEM_MESSAGES] } },
        },
        orderBy: { createdAt: 'desc' },
        take: TRANSCRIPT_LIMIT,
      })
    ).reverse()

    const contextEnabled = await isFeatureEnabled(HTPR_7734_AGENT_CHAT_CONTEXT_FLAG, ctx.user.id)
    const normalMessages = messages.map(({ id, role, content, context, createdAt }) => ({
      id,
      role,
      content: contextEnabled && role === 'human' ? agentChatContextPayload(content, context).text : content,
      ...(contextEnabled && role === 'human' && context ? { context } : {}),
      createdAt,
    }))
    const latestMessage = messages[messages.length - 1]
    let transcript: Array<Record<string, unknown>> = normalMessages
    if (
      latestMessage?.role === 'human' &&
      asksForAgentActivity(latestMessage.content) &&
      (await isFeatureEnabled('htpr-6094-agent-activity-rows', session.userId))
    ) {
      const activity = await listAgentChatActivity({
        agentId: tokenAgentId,
        sessionId: session.id,
        userId: ctx.user.id,
        teamScope: ctx.teamScope,
      })
      const activityContext = activityContextMessages(
        activity,
        Math.min(ACTIVITY_CONTEXT_LIMIT, TRANSCRIPT_LIMIT - 1)
      )
      transcript = [
        ...normalMessages.slice(-(TRANSCRIPT_LIMIT - activityContext.length), -1),
        ...activityContext,
        normalMessages[normalMessages.length - 1],
      ]
    }

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        userName: session.user.displayName,
      },
      messages: transcript,
    })
  } catch (error: any) {
    if (error instanceof TaskTeamScopeError) return NextResponse.json({ success: false, error: error.message }, { status: 404 })
    console.error('[mcp chat] GET messages failed:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to load chat messages' },
      { status: 500 }
    )
  }

  })(request)
}

type PostChatMessageBody = {
  text?: unknown
  replyToMessageId?: unknown
  proposal?: unknown
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
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
    const agentGate = requireAgentToken(ctx.agentId)
    if (agentGate) return agentGate
    const tokenAgentId = ctx.agentId as string

    const { sessionId } = await params
    const body = (await request.json().catch(() => null)) as PostChatMessageBody | null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text || text.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { success: false, error: 'text must be 1 to 8000 characters' },
        { status: 400 }
      )
    }
    const replyToMessageId =
      typeof body?.replyToMessageId === 'string' ? body.replyToMessageId.trim() : ''
    if (!replyToMessageId) {
      return NextResponse.json(
        { success: false, error: 'replyToMessageId is required' },
        { status: 400 }
      )
    }

    const access = await loadAgentTokenChatSession({
      principal: { userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope },
      sessionId,
      agentId: tokenAgentId,
      select: { userId: true },
    })
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      )
    }
    const session = access.session

    const serialize = async ({ id, role, content, createdAt, ticketProposal }: {
      id: string
      role: 'human' | 'assistant'
      content: string
      createdAt: Date
      ticketProposal?: Prisma.ChatTicketProposalGetPayload<{ select: typeof chatTicketProposalSelect }> | null
    }) => {
      if (ctx.teamScope != null && ticketProposal) {
        if (!await prisma.project.findFirst({ where: { id: ticketProposal.targetProjectId, ...projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) }, select: { id: true } }) || ticketProposal.taskId != null && !await prisma.task.findFirst({ where: { id: ticketProposal.taskId, project: projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) }, select: { id: true } })) throw new TaskTeamScopeError()
      }
      return { id, role, content, createdAt, proposal: serializeChatTicketProposal(ticketProposal) }
    }

    const target = await prisma.chatMessage.findFirst({
      where: { id: replyToMessageId, sessionId: session.id, role: 'human' },
      select: { id: true },
    })
    if (!target) {
      return NextResponse.json(
        { success: false, error: 'replyToMessageId is not a user message in this session' },
        { status: 400 }
      )
    }
    const existing = await prisma.chatMessage.findUnique({
      where: { replyToMessageId },
      include: { ticketProposal: { select: chatTicketProposalSelect } },
    })
    if (existing) {
      if (existing.sessionId !== session.id) {
        return NextResponse.json(
          { success: false, error: 'replyToMessageId already used by another session' },
          { status: 409 }
        )
      }
      if (isAgentChatSystemMessage(existing)) return NextResponse.json({ success: false, error: 'This chat turn is no longer active' }, { status: 409 })
      return NextResponse.json({
        success: true,
        message: await serialize(existing),
        duplicate: true,
      })
    }

    const parsedProposal = parseChatTicketProposal(body?.proposal)
    if (parsedProposal.error) {
      return NextResponse.json(
        { success: false, error: parsedProposal.error },
        { status: 400 }
      )
    }
    let proposalData: {
      outcome: string
      ticketTitle: string
      targetProjectId: number
      targetProjectTitle: string
      targetSectionId: number
      targetSectionTitle: string
    } | null = null
    if (parsedProposal.proposal) {
      const enabled = await isFeatureEnabled(
        AGENT_CHAT_TICKET_CONFIRM_FLAG,
        session.userId
      )
      if (enabled) {
        const scopeError = await requireRole(ctx, 'write')
        if (scopeError) return scopeError
        const projectCheck = await validateProjectAccess(
          parsedProposal.proposal.targetProjectId,
          session.userId,
          ctx.agentId, ctx.teamScope
        )
        if (projectCheck.error) {
          return NextResponse.json(
            { success: false, error: projectCheck.error.message },
            { status: projectCheck.error.status }
          )
        }
        const sectionCheck = await getSectionForTask(
          parsedProposal.proposal.targetProjectId,
          parsedProposal.proposal.targetSectionId
        )
        if (sectionCheck.error) {
          return NextResponse.json(
            { success: false, error: sectionCheck.error.message },
            { status: sectionCheck.error.status }
          )
        }
        proposalData = {
          outcome: parsedProposal.proposal.outcome,
          ticketTitle: parsedProposal.proposal.ticketTitle,
          targetProjectId: projectCheck.project.id,
          targetProjectTitle: projectCheck.project.title,
          targetSectionId: sectionCheck.section.id,
          targetSectionTitle: sectionCheck.section.section_title,
        }
      }
    }

    let message
    let createdProposal: Prisma.ChatTicketProposalGetPayload<{
      select: typeof chatTicketProposalSelect
    }> | null = null
    try {
      message = await prisma.$transaction(async (tx) => {
        if (ctx.teamScope != null) {
          await tx.$queryRaw`SELECT id FROM "ChatSession" WHERE id = ${session.id} FOR UPDATE`
          if (!await tx.chatSession.findFirst({ where: { id: session.id, ...await chatContentScopeWhere({ userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope }, tx) }, select: { id: true } })) throw new TaskTeamScopeError()
          if (proposalData) {
            await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${proposalData.targetProjectId} FOR UPDATE`
            if (!await tx.project.findFirst({ where: { id: proposalData.targetProjectId, ...projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) }, select: { id: true } })) throw new TaskTeamScopeError()
          }
        }
        await tx.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } })
        if (await tx.chatMessage.findUnique({ where: { replyToMessageId } })) throw Object.assign(new Error('Concurrent reply'), { code: 'P2002' })
        const created = await tx.chatMessage.create({
          data: {
            sessionId: session.id,
            content: text,
            role: 'assistant',
            isDelivered: true,
            replyToMessageId,
            authorAgentId: tokenAgentId,
          },
        })
        if (proposalData) {
          createdProposal = await tx.chatTicketProposal.create({
            data: { messageId: created.id, ...proposalData },
            select: chatTicketProposalSelect,
          })
        }
        return created
      }, ctx.teamScope != null ? { isolationLevel: 'Serializable' } : undefined)
    } catch (error: any) {
      if (error instanceof TaskTeamScopeError) return NextResponse.json({ success: false, error: error.message }, { status: 404 })
      if (error?.code !== 'P2002') throw error
      const existing = await prisma.chatMessage.findUnique({
        where: { replyToMessageId },
        include: { ticketProposal: { select: chatTicketProposalSelect } },
      })
      if (!existing || existing.sessionId !== session.id) throw error
      if (isAgentChatSystemMessage(existing)) return NextResponse.json({ success: false, error: 'This chat turn is no longer active' }, { status: 409 })
      return NextResponse.json({
        success: true,
        message: await serialize(existing),
        duplicate: true,
      })
    }

    if (createdProposal) {
      ;(message as { ticketProposal?: typeof createdProposal }).ticketProposal =
        createdProposal
    }

    await broadcastChatSession(session.id, [session.userId])

    return NextResponse.json({
      success: true,
      message: await serialize(message),
    })
  } catch (error: any) {
    if (error instanceof TaskTeamScopeError) return NextResponse.json({ success: false, error: error.message }, { status: 404 })
    console.error('[mcp chat] POST message failed:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to add chat message' },
      { status: 500 }
    )
  }

  })(request)
}
