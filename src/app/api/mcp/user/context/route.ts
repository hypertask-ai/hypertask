import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, createUnauthorizedResponse, checkMcpRateLimit } from '@/lib/mcp/auth'
import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'
import prisma from '@/lib/prisma'
import type { ProjectListItem } from '@/app/api/mcp/projects/route'
import { useResendVerificationEmail } from '@/hooks/useResendVerificationEmail'

export interface UserContextTeam {
  id: string
  title?: string
}

export interface UserContextResponse {
  success: boolean
  user: {
    id: number
    email: string
    displayName?: string
  }
  /** Present when the MCP JWT is bound to an Agent; omitted or null for user-only sessions */
  connected_agent?: {
    id: string
    displayName: string
  } | null
  /** Teams the user owns (Google account) or is an accepted member of — use id for POST /api/mcp/teams/:teamId/boards */
  teams?: UserContextTeam[]
  projects?: ProjectListItem[]
  all_agents?: {
    id: string
    displayName: string
  }[]
}

/**
 * GET /api/mcp/user/context
 * 
 * Returns the current user's context including:
 * - User information
 * - All boards/projects they have access to
 * - Permissions
 * 
 * Authentication: Bearer token (JWT or API key) in Authorization header
 * 
 * JWT Token (Recommended):
 * - Created via createMcpToken(userId, email)
 * - Contains user info, no DB lookup needed (faster)
 * - 30-day expiration by default
 * 
 * API Key (Alternative):
 * - Stored in ApiKey model
 * - Database-backed, can track usage
 */
export async function GET(request: NextRequest) {
  let userObj: {id: number, email: string} | null = null
  try {
    // Validate JWT token or API key and get user
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      // Use helper function that includes WWW-Authenticate header
      // This triggers Cursor to show the CONNECT button
      return createUnauthorizedResponse('Invalid or missing authentication token.', 'invalid_token')
    }

    const user = ctx.user
    userObj = user

    let agentSummary: {
      id: string;
      displayName: string;
    } | null = null;
    if (ctx.agentId) {
      const agentRow = await prisma.agent.findFirst({
        where: { id: ctx.agentId, userId: user.id, revokedAt: null },
        select: { id: true, displayName: true },
      });
      if (agentRow) {
        agentSummary = {
          id: agentRow.id,
          displayName: agentRow.displayName,
        };
      }
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { accountId: true }
    })

    const [ownedTeams, memberRows] = await Promise.all([
      dbUser?.accountId != null && dbUser.accountId.length > 0
      ? await prisma.team.findMany({
          where: { googleAccountId: dbUser.accountId },
          select: { id: true, title: true }
        })
      : [],
      await prisma.member_Team.findMany({
        where: { userId: user.id, status: 'Accepted' },
        include: {
          team: { select: { id: true, title: true } }
        }
      })
    ])


    const teamById = new Map<string, UserContextTeam>()
    for (const t of ownedTeams) {
      teamById.set(t.id, { id: t.id, title: t.title ?? undefined })
    }
    for (const row of memberRows) {
      if (row.team) {
        teamById.set(row.team.id, {
          id: row.team.id,
          title: row.team.title ?? undefined
        })
      }
    }

    const teams: UserContextTeam[] = Array.from(teamById.values()).sort((a, b) =>
      (a.title ?? a.id).localeCompare(b.title ?? b.id)
    )

    // Fetch projects (same structure as GET /api/mcp/projects)
    const projects = await prisma.project.findMany({
      where: {
        status: 'Normal',
        ...getProjectListingWhere(user.id, ctx.agentId),
      },
      select: {
        id: true,
        title: true,
        description: true,
        name: true,
        ownerId: true,
        owner: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        },
        status: true,
        sections: true,
        section: {
          select: {
            id: true,
            section_title: true
          }
        },
        labels: {
          select: {
            id: true,
            value: true
          }
        },
        createdAt: true,
        _count: {
          select: {
            members: true,
            tasks: {
              where: { status: 'Normal' }
            }
          }
        }
      },
      orderBy: { title: 'asc' }
    })

    const agentsByUser = await prisma.agent.findMany({
      where: { userId: user.id },
      select: { id: true, displayName: true }
    })

    const all_agents = agentsByUser.map(agent => ({
      id: agent.id,
      displayName: agent.displayName
    }))

    const projectList: ProjectListItem[] = projects.map(project => ({
      id: project.id,
      title: project.title || '',
      description: project.description || undefined,
      name: project.name,
      ownerId: project.ownerId,
      owner: project.owner ? {
        id: project.owner.id,
        email: project.owner.email,
        displayName: project.owner.displayName || undefined
      } : undefined,
      memberCount: project._count.members,
      taskCount: project._count.tasks,
      defaultSections: project.sections || [],
      sections: project.section,
      labels: (project.labels || []).map(l => ({
        id: l.id,
        name: l.value || ''
      })),
      status: project.status,
      createdAt: project.createdAt.toISOString(),
    }))

    const response: UserContextResponse = {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName || undefined
      },
      connected_agent: agentSummary,
      teams,
      projects: projectList,
      all_agents,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[MCP] user/context', {
      user: userObj,
      error,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
