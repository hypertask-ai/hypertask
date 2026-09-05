import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { AGENT_CHAT_EVENT, broadcast, userChannel } from '@/lib/realtime/server'
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

/**
 * GET /api/mcp/chat/sessions/[sessionId]/messages
 *
 * Agent-readable transcript of one Agent Chat session. Only the session's own
 * agent (the agentId on the bearer token) may read it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
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

    const { sessionId } = await params
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId },
      select: {
        id: true,
        agentId: true,
        userId: true,
        user: { select: { displayName: true } },
      },
    })
    if (!session || !session.agentId) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      )
    }
    if (session.agentId !== ctx.agentId) {
      return NextResponse.json(
        { success: false, error: 'This session belongs to a different agent' },
        { status: 403 }
      )
    }

    // Last 50, oldest first: page desc from the tail, then flip.
    const messages = (
      await prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'desc' },
        take: TRANSCRIPT_LIMIT,
      })
    ).reverse()

    const normalMessages = messages.map(({ id, role, content, createdAt }) => ({
      id,
      role,
      content,
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
        agentId: session.agentId,
        sessionId: session.id,
        userId: session.userId,
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
    console.error('[mcp chat] GET messages failed:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to load chat messages' },
      { status: 500 }
    )
  }
}

type PostChatMessageBody = {
  text?: unknown
  replyToMessageId?: unknown
  proposal?: unknown
}

/**
 * POST /api/mcp/chat/sessions/[sessionId]/messages
 *
 * The agent runtime posts its reply here. `replyToMessageId` is the
 * idempotency key: a retried POST with the same value returns the already
 * stored reply instead of creating a second one.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
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

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId },
      select: { id: true, agentId: true, userId: true },
    })
    if (!session || !session.agentId) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      )
    }
    if (session.agentId !== ctx.agentId) {
      return NextResponse.json(
        { success: false, error: 'This session belongs to a different agent' },
        { status: 403 }
      )
    }

    const serialize = ({ id, role, content, createdAt, ticketProposal }: {
      id: string
      role: 'human' | 'assistant'
      content: string
      createdAt: Date
      ticketProposal?: unknown
    }) => ({ id, role, content, createdAt,
      proposal: serializeChatTicketProposal(ticketProposal as any) })

    // A proposal is the whole point of the confirm-before-side-effects boundary:
    // the agent asks for a ticket instead of doing the work. Everything is
    // checked before anything is stored, so a rejected proposal creates nothing.
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
      // Flag off: keep the reply, drop the card. Rejecting the whole POST would
      // break the turn for every user who does not have the feature yet.
      const enabled = await isFeatureEnabled(
        AGENT_CHAT_TICKET_CONFIRM_FLAG,
        session.userId
      )
      if (enabled) {
        // The ticket the user confirms is created with the agent's write role
        // and the chat user's board rights: the intersection, never either alone.
        const scopeError = await requireRole(ctx, 'write')
        if (scopeError) return scopeError
        const projectCheck = await validateProjectAccess(
          parsedProposal.proposal.targetProjectId,
          session.userId,
          ctx.agentId
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
      return NextResponse.json({
        success: true,
        message: serialize(existing),
        duplicate: true,
      })
    }

    let message
    let createdProposal: any = null
    try {
      message = await prisma.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: {
            sessionId: session.id,
            content: text,
            role: 'assistant',
            isDelivered: true,
            replyToMessageId,
          },
        })
        // Same transaction, and messageId is unique: one reply carries at most
        // one proposal, and a retried POST can never add a second.
        if (proposalData) {
          createdProposal = await tx.chatTicketProposal.create({
            data: { messageId: created.id, ...proposalData },
            select: chatTicketProposalSelect,
          })
        }
        await tx.chatSession.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        })
        return created
      })
    } catch (error: any) {
      // Lost a race against a concurrent reply with the same idempotency key.
      if (error?.code !== 'P2002' || !replyToMessageId) throw error
      const existing = await prisma.chatMessage.findUnique({
        where: { replyToMessageId },
        include: { ticketProposal: { select: chatTicketProposalSelect } },
      })
      if (!existing || existing.sessionId !== session.id) throw error
      return NextResponse.json({
        success: true,
        message: serialize(existing),
        duplicate: true,
      })
    }

    if (createdProposal) {
      ;(message as { ticketProposal?: unknown }).ticketProposal = createdProposal
    }

    // The user's open Agent Chat tab refetches the thread; fire and forget.
    void broadcast(userChannel(session.userId), AGENT_CHAT_EVENT, {
      sessionId: session.id,
    })

    return NextResponse.json({
      success: true,
      message: serialize(message),
    })
  } catch (error: any) {
    console.error('[mcp chat] POST message failed:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to add chat message' },
      { status: 500 }
    )
  }
}
