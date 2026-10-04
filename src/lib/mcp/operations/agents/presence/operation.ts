import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  getTeamAgentPresence,
  TeamAgentPresenceNotFoundError,
} from '@/lib/mcp/agents/presence'
import prisma from '@/lib/prisma'

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'Unauthorized. Invalid or missing authentication token.',
    },
    { status: 401 }
  )
}

export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) return unauthorized()

    const teamId = request.nextUrl.searchParams.get('team_id')?.trim()
    if (!teamId) {
      return NextResponse.json(
        { success: false, error: 'team_id is required' },
        { status: 400 }
      )
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        accountId: true,
      },
    })

    if (!dbUser) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not found',
          message: 'User not found',
        },
        { status: 404 }
      )
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, googleAccountId: true },
    })

    if (!team) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not found',
          message: 'Team not found',
          details: { field: 'team_id', code: 'not_found' },
        },
        { status: 404 }
      )
    }

    const membership = await prisma.member_Team.findFirst({
      where: {
        userId: ctx.user.id,
        teamId: team.id,
        status: 'Accepted',
      },
      select: { id: true },
    })
    const ownsTeam =
      dbUser.accountId != null &&
      dbUser.accountId === team.googleAccountId

    if (!membership && !ownsTeam) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'User cannot view agent presence for this team',
          details: { field: 'team_id', code: 'forbidden' },
        },
        { status: 403 }
      )
    }

    const agents = await getTeamAgentPresence(team.id)
    return NextResponse.json({ success: true, agents })
  } catch (error) {
    if (error instanceof TeamAgentPresenceNotFoundError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not found',
          message: 'Team not found',
          details: { field: 'team_id', code: 'not_found' },
        },
        { status: 404 }
      )
    }

    console.error('[MCP Agent Presence] GET Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
