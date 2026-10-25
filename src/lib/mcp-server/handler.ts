import { aiFeedbackEnabled } from '@/lib/aiFeedback/enabled'
import { observeFeedbackTools, queueAiFeedback, queueMcpAuthFailure } from '@/lib/aiFeedback/automatic'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import jwt from 'jsonwebtoken'
import { MCP_TOOLS } from './tools'
import { handleLegacySseRequest, isLegacySseRequest } from './legacy-sse'
import { recordLegacyMcpRequest } from '@/lib/telemetry/mcpSseAnalytics'
import {
  McpAttachmentRequestBodyError,
  readRequestBytesWithCap,
} from '@/lib/mcp/attachments/readRequestBody'
import { MCP_ATTACHMENT_MAX_REQUEST_BYTES } from '@/lib/mcp/attachments/constants'
import { extractBearerToken, validateMcpAuth } from '@/lib/mcp/auth'
import { hasAnyManagementPermission } from '@/lib/mcp/managementPermissions'
import { resolvePortableTools } from './listQueryContract'
import { selectMcpTools } from './consolidated-tools'
import { isMcpV2Enabled } from '@/lib/mcp/mcpV2'
import { getAgentRole } from '@/lib/mcp/agents/scopes'
import { featureFlagCandidateUserIds, isFeatureEnabled, HTPR_6804_MCP_TOOLS_FLAG, HTPR_7203_MCP_FLAT_SCHEMA_FLAG } from '@/lib/flags'
import { HTPR_7863_MCP_PAGE_ALIAS_FLAG } from '@/lib/flags/definitions/htpr-7863-mcp-page-alias'
import { HTPR_7390_MCP_HANDSHAKE_FEEDBACK_FLAG } from '@/lib/flags/definitions/htpr-7390-mcp-handshake-feedback'
import type { ManagementPermissions } from '@/lib/mcp/managementPermissions'
import { NextRequest } from 'next/server'
import { withMcpExecutionContext } from '@/lib/mcp/operationContext'
import type { McpAuthContext } from '@/lib/mcp/auth/types'
import { handleMcpHttp } from './mcp-http'
import {
  handleStatelessMcpRequest,
  mcpUnauthorizedResponse,
  type PortableTool,
} from './stateless-http'

async function verifyToken(_request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined

  const headers = new Headers(_request.headers)
  headers.set('Authorization', `Bearer ${bearerToken}`)
  const request = new NextRequest(_request.url, {
    method: _request.method,
    headers,
  })
  const ctx = await validateMcpAuth(request, {
    deferManagementPermissionCheck: true,
  })
  if (!ctx) return undefined

  if (ctx.management) {
    if (!hasAnyManagementPermission(ctx.management.permissions)) return undefined
    return {
      token: bearerToken,
      clientId: String(ctx.user.id),
      scopes: ['mcp:management'],
      extra: { managementPermissions: ctx.management.permissions, teamScoped: Boolean(ctx.management.teamId), mcpAuthContext: ctx },
    }
  }

  const decoded = jwt.decode(bearerToken)
  const expiresAt =
    decoded && typeof decoded !== 'string' && typeof decoded.exp === 'number'
      ? decoded.exp
      : undefined
  return {
    token: bearerToken,
    clientId: String(ctx.user.id),
    scopes: ['mcp:full'],
    expiresAt,
    extra: { agent: Boolean(ctx.agentId), mcpAuthContext: ctx },
  }
}

async function boundMcpRequest(request: Request): Promise<Request> {
  if (request.method !== 'POST' || !request.body) return request
  const body = await readRequestBytesWithCap(
    request,
    MCP_ATTACHMENT_MAX_REQUEST_BYTES
  )
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

const portableTools = MCP_TOOLS as PortableTool[]
function optionsPortableTools() {
  return portableTools
}

async function keylessHandshakeFeedbackIsQuiet(): Promise<boolean> {
  try {
    return await featureFlagCandidateUserIds(HTPR_7390_MCP_HANDSHAKE_FEEDBACK_FLAG) === null
  } catch {
    return false
  }
}

export async function mcpHandler(request: Request): Promise<Response> {
  const timestamp = new Date()
  let telemetryUserId: number | undefined
  try {
    let working = request
    try {
      working = await boundMcpRequest(request)
    } catch (error) {
      if (!(error instanceof McpAttachmentRequestBodyError)) throw error
      return Response.json(
        {
          jsonrpc: '2.0',
          error: { code: -32600, message: error.message },
          id: null,
        },
        { status: error.status }
      )
    }

    if (working.method === 'OPTIONS') {
      return handleStatelessMcpRequest(working, null, optionsPortableTools())
    }

    const bearer = extractBearerToken(working.headers.get('Authorization'))
    const authInfo = await verifyToken(working, bearer ?? undefined)
    if (!authInfo) {
      if (bearer) queueMcpAuthFailure(working)
      else if (!(await keylessHandshakeFeedbackIsQuiet())) {
        queueAiFeedback({ surface: 'mcp', tool: 'mcp', status: 401, errorCode: 'unauthorized' })
      }
      return mcpUnauthorizedResponse(working)
    }

    const userId = Number(authInfo.clientId)
    if (Number.isFinite(userId)) telemetryUserId = userId
    const ctx = authInfo.extra?.mcpAuthContext as McpAuthContext
    const v2 = await isMcpV2Enabled(ctx.user.id)
    const feedbackEnabled = await aiFeedbackEnabled(ctx.user.id)
    const resolvedTools = resolvePortableTools(MCP_TOOLS as PortableTool[])
    const availableTools = resolvedTools.filter((tool) => feedbackEnabled || tool.name !== 'hypertask_report_feedback')
    const consolidated = Number.isFinite(userId) && await isFeatureEnabled(HTPR_6804_MCP_TOOLS_FLAG, userId)
    const portableTools = observeFeedbackTools(selectMcpTools(
      availableTools,
      consolidated,
      {
        managementPermissions: authInfo.extra?.managementPermissions as ManagementPermissions | undefined,
        teamScoped: authInfo.extra?.teamScoped === true,
        agent: authInfo.extra?.agent === true,
        ...(v2 && ctx.agentId ? { agentRole: await getAgentRole(ctx) } : {}),
      },
      v2,
      consolidated && await isFeatureEnabled(HTPR_7203_MCP_FLAT_SCHEMA_FLAG, ctx.user.id),
      consolidated && await isFeatureEnabled(HTPR_7863_MCP_PAGE_ALIAS_FLAG, ctx.user.id),
    ), ctx.user.id)
    if (isLegacySseRequest(working)) {
      return handleLegacySseRequest(working, authInfo, resolvedTools, portableTools)
    }

    return withMcpExecutionContext(authInfo.token, authInfo.extra?.mcpAuthContext as McpAuthContext, () =>
      handleMcpHttp(working, {
        authenticate: async () => authInfo,
        tools: portableTools,
      }),
    )
  } finally {
    recordLegacyMcpRequest(request, telemetryUserId, timestamp)
  }
}
