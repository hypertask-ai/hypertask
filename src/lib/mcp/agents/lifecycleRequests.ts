/**
 * `PATCH /api/mcp/agents/[agentId]`: rename an owned agent, switch it back on,
 * or file it away in the register.
 * Board membership changes use the same owned-agent operation.
 *
 * Launch is the missing opposite of revoke. It lives on the shared `/api/mcp/*`
 * layer, next to the existing DELETE, so the CLI, the MCP server and AI chat
 * inherit it from one place instead of each keeping a copy (CLAUDE.md,
 * HTPR-5418).
 */
import { clearAgentRuntimeSnapshot } from '@/lib/agents/runtimeState'
import {
  agentTokenCredentialFields,
  checkMcpRateLimit,
  createMcpToken,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { hasManagementWritePermission } from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'
import { getAccessibleAgentBoard } from '@/utils/controllers/agents/boardMembers'
import { NextRequest, NextResponse } from 'next/server'
import {
  AgentBoardUpdateError,
  parseAgentBoardUpdateBody,
  updateOwnedAgentBoards,
  type AgentBoardUpdateDatabase,
} from './updateBoards'
import {
  archiveOwnedAgent,
  launchOwnedAgent,
  renameOwnedAgent,
  type AgentLifecycleDatabase,
  type AgentLifecycleDeps,
  type AgentLifecycleRow,
} from './lifecycle'

type AgentPatchBody = {
  revoked?: unknown
  archived?: unknown
  display_name?: unknown
  add_project_ids?: unknown
  remove_project_ids?: unknown
}

export const agentLifecycleDeps: AgentLifecycleDeps = {
  mintToken: (userId, email, agentId) =>
    createMcpToken(userId, email, undefined, agentId),
  clearRuntime: (agentId) => clearAgentRuntimeSnapshot(agentId),
  credentialFields: (token) => agentTokenCredentialFields(token),
}

const notFound = () =>
  NextResponse.json({ success: false, error: 'Agent not found' }, { status: 404 })

export async function handlePatchAgentRequest(
  request: NextRequest,
  rawAgentId: string
): Promise<NextResponse> {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  // Same gate the sibling DELETE uses: a human or a write-scoped management
  // key, never an agent credential acting on other agents.
  const ctx = await validateMcpAuth(request, {
    deferManagementPermissionCheck: true,
  })
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
    return NextResponse.json(
      { success: false, error: 'Agents cannot manage agents' },
      { status: 403 }
    )
  }
  if (
    ctx.management &&
    !hasManagementWritePermission(ctx.management.permissions)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Management key does not have permission to manage agents',
      },
      { status: 403 }
    )
  }

  const agentId = rawAgentId.trim()
  if (!agentId) {
    return NextResponse.json(
      buildFieldError(
        'invalid_field',
        'agent_id',
        'agent_id must be a non-empty string'
      ),
      { status: 400 }
    )
  }

  let body: AgentPatchBody
  try {
    body = (await request.json()) as AgentPatchBody
  } catch {
    return NextResponse.json(
      buildFieldError('invalid_field', 'body', 'Request body must be valid JSON'),
      { status: 400 }
    )
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      buildFieldError('invalid_field', 'body', 'Request body must be a JSON object'),
      { status: 400 }
    )
  }

  const wantsLaunch = body.revoked !== undefined
  const wantsArchive = body.archived !== undefined
  const wantsRename = body.display_name !== undefined
  const wantsBoardUpdate =
    body.add_project_ids !== undefined || body.remove_project_ids !== undefined
  if (wantsBoardUpdate) {
    if (wantsLaunch || wantsArchive || wantsRename) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'body',
          'Board membership changes cannot be combined with other agent updates'
        ),
        { status: 400 }
      )
    }
    try {
      const input = parseAgentBoardUpdateBody({ ...body, agent_id: agentId })
      const result = await updateOwnedAgentBoards(
        prisma as unknown as AgentBoardUpdateDatabase,
        getAccessibleAgentBoard,
        ctx.user.id,
        input
      )
      return NextResponse.json({
        success: true,
        agent: { id: result.agentId },
        changes: {
          added_projects: result.addedProjects,
          removed_projects: result.removedProjects,
        },
      })
    } catch (error) {
      if (error instanceof AgentBoardUpdateError) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            ...(error.field ? { field: error.field } : {}),
          },
          { status: error.status }
        )
      }
      console.error('[MCP Update Agent Boards] Error:', error)
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      )
    }
  }
  if (!wantsLaunch && !wantsArchive && !wantsRename) {
    return NextResponse.json(
      buildFieldError(
        'missing_field',
        'body',
        'Send display_name to rename the agent, revoked=false to switch it on, or archived to file it away'
      ),
      { status: 400 }
    )
  }
  if (wantsLaunch && body.revoked !== false) {
    return NextResponse.json(
      buildFieldError(
        'invalid_field',
        'revoked',
        'Only revoked=false is accepted here; use POST /api/mcp/agents/revoke to switch an agent off'
      ),
      { status: 400 }
    )
  }
  if (wantsArchive && typeof body.archived !== 'boolean') {
    return NextResponse.json(
      buildFieldError('invalid_field', 'archived', 'archived must be a boolean'),
      { status: 400 }
    )
  }
  let displayName: string | undefined
  if (wantsRename) {
    if (typeof body.display_name !== 'string') {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'display_name',
          'display_name must be a string'
        ),
        { status: 400 }
      )
    }
    displayName = body.display_name.trim()
    if (displayName.length < 1 || displayName.length > 60) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'display_name',
          'display_name must be between 1 and 60 characters'
        ),
        { status: 400 }
      )
    }
  }

  const database = prisma as unknown as AgentLifecycleDatabase
  let currentAgent: AgentLifecycleRow | undefined
  let alreadyRunning = false
  let token: string | null = null

  if (wantsArchive) {
    const archived = await archiveOwnedAgent(
      database,
      ctx.user.id,
      agentId,
      body.archived as boolean
    )
    if (archived.status === 'not_found') return notFound()
    currentAgent = archived.agent
  }

  if (wantsLaunch) {
    const result = await launchOwnedAgent(
      database,
      agentLifecycleDeps,
      ctx.user.id,
      agentId
    )
    if (result.status === 'not_found') return notFound()
    if (result.status === 'runtime_invalidation_failed') {
      return NextResponse.json(
        {
          success: false,
          error: 'Could not clear the previous runtime state. Try again.',
        },
        { status: 503 }
      )
    }
    if (result.status === 'owner_missing') {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      )
    }
    currentAgent = result.agent
    alreadyRunning = result.alreadyRunning
    token = result.token
  }

  if (wantsRename) {
    const renamed = await renameOwnedAgent(
      database,
      ctx.user.id,
      agentId,
      displayName!
    )
    if (renamed.status === 'not_found') return notFound()
    currentAgent = renamed.agent
  }

  // At least one operation was validated above, so a row exists unless a
  // preceding operation returned an error.
  if (!currentAgent) return notFound()

  return NextResponse.json({
    success: true,
    agent: describe(currentAgent),
    ...(wantsLaunch ? { already_running: alreadyRunning } : {}),
    // Revealed once, and only when this call minted it. A native agent has no
    // credential of its own, so the field is absent for one.
    ...(token ? { token } : {}),
  })
}

function describe(agent: AgentLifecycleRow) {
  return {
    id: agent.id,
    display_name: agent.displayName,
    revoked: agent.revokedAt !== null,
    revoked_at: agent.revokedAt?.toISOString() ?? null,
    archived: agent.archivedAt !== null,
    archived_at: agent.archivedAt?.toISOString() ?? null,
    runtime_type: agent.runtimeType,
    has_token: Boolean(agent.mcpTokenJti),
  }
}
