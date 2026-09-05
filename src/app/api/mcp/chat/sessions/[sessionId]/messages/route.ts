import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { AGENT_CHAT_EVENT, broadcast, userChannel } from '@/lib/realtime/server'
import { listAgentChatActivity } from '@/lib/agents/agentChatActivity'
import { activityContextMessages, asksForAgentActivity } from '@/lib/agents/chatActivityFeed'
import { isFeatureEnabled } from '@/lib/flags'

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

    const serialize = ({ id, role, content, createdAt }: {
      id: string
      role: 'human' | 'assistant'
      content: string
      createdAt: Date
    }) => ({ id, role, content, createdAt })

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
      })
      if (!existing || existing.sessionId !== session.id) throw error
      return NextResponse.json({
        success: true,
        message: serialize(existing),
        duplicate: true,
      })
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
