import {
  agentTokenCredentialFields,
  type AgentTokenTeamScope,
  checkMcpRateLimit,
  createMcpToken,
  managementAgentTokenScope,
  type McpAuthContext,
  validateManagementOrSessionAuth,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { hasManagementWritePermission } from '@/lib/mcp/managementPermissions'
import { agentWithinTeamWhere } from '@/lib/mcp/managementKeyTeamScope'
import prisma from '@/lib/prisma'
import {
  getAccessibleAgentBoard,
  isAgentOnBoard,
} from '@/utils/controllers/agents/boardMembers'
import { lockTeamAgentSeed } from '@/utils/controllers/agents/ensureDefaultTeamAgent'
import {
  canAttachAgentToTeam,
  getAgentTeamId,
} from '@/utils/controllers/agents/teamScope'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, type AgentRole } from './scopes'

const AGENT_ROLES: readonly AgentRole[] = ['read', 'write', 'admin']

type CreateAgentBody = {
  display_name?: unknown
  project_ids?: unknown
  role?: unknown
}

function fieldError(
  code: 'invalid_field' | 'missing_field',
  field: string,
  message: string
) {
  return NextResponse.json(buildFieldError(code, field, message), {
    status: 400,
  })
}

export async function handleCreateAgentRequest(
  request: NextRequest,
  authMode: 'mcp' | 'management' = 'mcp'
): Promise<NextResponse> {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  let ctx = authMode === 'management'
    ? await validateManagementOrSessionAuth(request, 'write')
    : await validateMcpAuth(request, { deferManagementPermissionCheck: true })
  if (!ctx && authMode === 'management') {
    const agentCtx = await validateMcpAuth(request)
    if (agentCtx?.agentId) ctx = agentCtx
  }
  if (!ctx) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Invalid or missing authentication token.',
      },
      { status: 401 }
    )
  }
  if (ctx.agentId) {
    const roleError = await requireRole(ctx, 'write')
    if (roleError) return roleError
  }
  if (
    ctx.management &&
    !hasManagementWritePermission(ctx.management.permissions)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Management key does not have permission to create agents',
      },
      { status: 403 }
    )
  }

  return createAgentForUser(
    request,
    ctx.user,
    managementAgentTokenScope(ctx.management),
    ctx.agentId ?? undefined
  )
}

export async function createAgentForUser(
  request: NextRequest,
  user: McpAuthContext['user'],
  teamScope?: AgentTokenTeamScope,
  callerAgentId?: string
): Promise<NextResponse> {
  const teamId = teamScope?.teamId

  let body: CreateAgentBody
  try {
    body = (await request.json()) as CreateAgentBody
  } catch {
    return fieldError(
      'invalid_field',
      'body',
      'Request body must be valid JSON'
    )
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fieldError(
      'invalid_field',
      'body',
      'Request body must be a JSON object'
    )
  }

  if (body.display_name === undefined) {
    return fieldError(
      'missing_field',
      'display_name',
      'display_name is required'
    )
  }
  if (typeof body.display_name !== 'string') {
    return fieldError(
      'invalid_field',
      'display_name',
      'display_name must be a string'
    )
  }
  const displayName = body.display_name.trim()
  if (displayName.length < 1 || displayName.length > 60) {
    return fieldError(
      'invalid_field',
      'display_name',
      'display_name must be between 1 and 60 characters'
    )
  }

  if (
    body.role !== undefined &&
    (typeof body.role !== 'string' ||
      !AGENT_ROLES.includes(body.role as AgentRole))
  ) {
    return fieldError(
      'invalid_field',
      'role',
      "role must be one of: 'read', 'write', 'admin'"
    )
  }
  const role = (body.role ?? 'write') as AgentRole
  if (callerAgentId && role !== 'read') {
    return NextResponse.json(
      {
        success: false,
        error: 'Agents can provision only read-role agents',
        code: 'insufficient_scope',
      },
      { status: 403 }
    )
  }

  let projectIds: number[] = []
  if (body.project_ids !== undefined) {
    if (
      !Array.isArray(body.project_ids) ||
      !body.project_ids.every(
        (projectId) => Number.isSafeInteger(projectId) && projectId > 0
      )
    ) {
      return fieldError(
        'invalid_field',
        'project_ids',
        'project_ids must be an array of positive integers'
      )
    }
    projectIds = [...new Set(body.project_ids as number[])]
  }
  if (callerAgentId && projectIds.length === 0) {
    return fieldError(
      'missing_field',
      'project_ids',
      'Agent-created identities must belong to at least one board'
    )
  }
  if (teamId && projectIds.length === 0) {
    return fieldError(
      'missing_field',
      'project_ids',
      'A team-scoped key must add the agent to at least one team board'
    )
  }

  if (callerAgentId) {
    for (const projectId of projectIds) {
      if (!(await isAgentOnBoard(projectId, callerAgentId))) {
        return NextResponse.json(
          {
            success: false,
            error: `The provisioning agent must already belong to project ${projectId}`,
          },
          { status: 403 }
        )
      }
    }
  }

  // Revoked identities are excluded so owners can deliberately reuse their display names.
  const existingAgent = await prisma.agent.findFirst({
    where: {
      userId: user.id,
      displayName,
      revokedAt: null,
      ...(teamId ? agentWithinTeamWhere(teamId) : {}),
    },
    select: { id: true },
  })
  if (existingAgent) {
    return NextResponse.json(
      {
        success: false,
        error: teamId
          ? `An agent named "${displayName}" already exists in this team.`
          : `An agent named "${displayName}" already exists (id ${existingAgent.id}). Its token is shown only at creation. Rotate it with POST /api/mcp/admin/agents/${existingAgent.id}/token or the MCP rotate-token endpoint; rotating invalidates the old token.`,
      },
      { status: 409 }
    )
  }

  const projects = []
  for (const projectId of projectIds) {
    const project = await getAccessibleAgentBoard(projectId, user.id)
    if (!project) {
      return NextResponse.json(
        {
          success: false,
          error: `You do not have access to project ${projectId}`,
        },
        { status: 403 }
      )
    }
    projects.push(project)
  }
  if (teamId && projects.some((project) => project.teamId !== teamId)) {
    return NextResponse.json(
      {
        success: false,
        error: 'A team-scoped key can create agents only in its own team',
      },
      { status: 403 }
    )
  }

  const memberTeamIds = projects.map((project) => project.teamId)
  if (memberTeamIds.some((teamId) => teamId === null)) {
    return fieldError(
      'invalid_field',
      'project_ids',
      'Agents require a team board'
    )
  }
  const targetTeamId = getAgentTeamId(memberTeamIds)
  if (
    targetTeamId &&
    !canAttachAgentToTeam(memberTeamIds, targetTeamId)
  ) {
    return fieldError(
      'invalid_field',
      'project_ids',
      'Agents can only belong to boards in one team'
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    if (targetTeamId) {
      await lockTeamAgentSeed(tx, user.id, targetTeamId)
    }
    const createdAgent = await tx.agent.create({
      data: {
        displayName,
        userId: user.id,
        permissions: { role },
      },
      select: {
        id: true,
        displayName: true,
        photoURL: true,
      },
    })

    const token = createMcpToken(
      user.id,
      user.email,
      undefined,
      createdAgent.id,
      teamScope
    )

    await tx.agent.update({
      where: { id: createdAgent.id },
      data: {
        ...agentTokenCredentialFields(token),
        mcpTokenExpiresAt: null,
        credentialTeamId: teamScope?.teamId ?? null,
        credentialTeamAccessBinding: teamScope?.accessBinding ?? null,
      },
    })

    if (projectIds.length > 0) {
      await tx.member.createMany({
        data: projectIds.map((projectId) => ({
          projectId,
          userId: user.id,
          agentId: createdAgent.id,
        })),
      })
    }

    return { agent: createdAgent, token }
  })

  return NextResponse.json(
    {
      success: true,
      agent: {
        id: result.agent.id,
        display_name: result.agent.displayName,
        photo_url: result.agent.photoURL,
      },
      token: result.token,
      message: 'Store this token securely. It will not be shown again.',
    },
    { status: 201 }
  )
}
