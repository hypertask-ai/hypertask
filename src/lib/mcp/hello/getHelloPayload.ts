import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

import {
  checkMcpRateLimit,
  createUnauthorizedResponse,
  validateMcpAuth,
  type McpAuthContext,
} from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { DECISIONS_GUIDANCE } from '@/lib/mcp/featureCatalog'
import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'

import { buildGuidedStart } from './guidedStart'

const BOARD_LIMIT = 50
const PER_BOARD_TEXT_LIMIT = 2000
const CONVENTIONS_TOTAL_LIMIT = 8 * 1024
const TRUNCATION_MARKER = '… [truncated]'

export const HELLO_URL_FORMATS = {
  ticket: 'https://app.hypertask.ai/detail/project-{boardId}/{taskNumber}',
  comment: 'https://app.hypertask.ai/detail/project-{boardId}/{taskNumber}#comment-{commentId}',
  board: 'https://app.hypertask.ai/project?id={boardId}',
  boardView: 'https://app.hypertask.ai/project?id={boardId}&view={viewSlug}',
  inboxSplit: 'https://app.hypertask.ai/inbox?split={splitName}&projectId={boardId}',
  page: 'https://app.hypertask.ai/page/{pagePublicId}',
  rules: 'taskNumber is the number after the ticket prefix (HTPR-7321 is 7321) on the board the task is on now, never the global task id. boardId is the numeric board id. Prefer the url or link field a tool returns over building one.',
} as const

export const HELLO_CAPABILITIES = {
  decisions: DECISIONS_GUIDANCE,
  features:
    'List every enabled feature-kind flag and core product destinations for the authenticated user, with registry descriptions, shipped dates and verified URLs where known, through hypertask_list_features (hypertask_user_context action features) or GET /api/mcp/features. Non-feature kinds and unavailable features are omitted.',
  tasks:
    'Create, read, update, search, move, archive, and relate tasks with MCP tools or /api/mcp/tasks/*, including risk level, acceptance criteria, and verify command for structured contracts.',
  batch:
    'Read or update up to 100 tasks in one request through POST /api/mcp/tasks/batch.',
  comments:
    'Read comments and add markdown-in comments through the comment tools or /api/mcp/comments.',
  pages:
    'Create, read, update, list, and search task-attached pages, with markdown as the default format.',
  leases:
    'Claim work, heartbeat active leases, and release tasks through /api/mcp/tasks/lease/*.',
  evidence:
    'Attach and list typed proof of work through /api/mcp/tasks/evidence.',
  sessions:
    'Attach resumable agent work sessions to tasks through /api/mcp/tasks/session.',
  escalate:
    'Escalate blocked tasks with a reason and optional evidence through /api/mcp/tasks/escalate.',
  nextTask:
    'Pick the next eligible task from accessible boards through /api/mcp/tasks/next.',
  webhooks:
    'Use signed per-agent webhooks to wake an agent on mentions and assignments, or SSE streams for board events. Setup and verification: https://docs.hypertask.ai/mcp/agent-webhooks/',
} as const

export const HTPR_7122_HELLO_CAPABILITIES = {
  ...HELLO_CAPABILITIES,
  comments:
    'Read comments and add markdown-in comments through the comment tools or /api/mcp/comments. To acknowledge or confirm a person\'s comment, react with an emoji instead of posting an ack comment.',
  reactions:
    'React to a person\'s comment with a thumbs up or any emoji through POST /api/mcp/comments/{comment_id}/reactions with {"emoji":"👍","active":true} (active false removes it), or `hypertask comment react <comment_id> --emoji 👍`. Post a comment only when you have something new to say. Your reaction is saved and shown as you, the agent. An agent\'s reaction never counts as an approval or decision; only a person\'s own reaction does.',
  abilities:
    'Use all of Hypertask\'s abilities, not only comments: reactions, pages, evidence, leases, sessions, escalation, task moves and labels.',
} as const

async function helloGuidedStart(
  ctx: McpAuthContext,
  where: Prisma.ProjectWhereInput
) {
  const [{ isFeatureEnabled, HTPR_6804_MCP_TOOLS_FLAG }, { HTPR_7519_LOGIN_GUIDED_START_FLAG }] = await Promise.all([
    import('@/lib/flags'),
    import('@/lib/flags/definitions/htpr-7519-login-guided-start'),
  ])
  if (!(await isFeatureEnabled(HTPR_7519_LOGIN_GUIDED_START_FLAG, ctx.user.id))) return {}
  const newestBoard = await prisma.project.findFirst({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, title: true, name: true },
  })
  const agent = ctx.agentId
    ? await prisma.agent.findUnique({
        where: { id: ctx.agentId },
        select: { id: true, displayName: true },
      })
    : null
  const { getAgentRole } = await import('@/lib/mcp/agents/scopes')
  const consolidated = Number.isFinite(ctx.user.id) && await isFeatureEnabled(HTPR_6804_MCP_TOOLS_FLAG, ctx.user.id)
  return { agent, ...buildGuidedStart(newestBoard, consolidated, await getAgentRole(ctx)) }
}

async function helloCapabilities(userId: number) {
  const [{ isFeatureEnabled }, { HTPR_7122_AGENT_REACTIONS_FLAG }] = await Promise.all([
    import('@/lib/flags'),
    import('@/lib/flags/definitions/htpr-7122-agent-reactions'),
  ])
  return (await isFeatureEnabled(HTPR_7122_AGENT_REACTIONS_FLAG, userId))
    ? HTPR_7122_HELLO_CAPABILITIES
    : HELLO_CAPABILITIES
}

function truncateText(value: string): string {
  if (value.length <= PER_BOARD_TEXT_LIMIT) return value
  return `${value.slice(0, PER_BOARD_TEXT_LIMIT - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
}

function truncatePlaybook(playbook: Prisma.JsonValue): Prisma.JsonValue {
  if (JSON.stringify(playbook).length <= PER_BOARD_TEXT_LIMIT) return playbook

  let remaining = PER_BOARD_TEXT_LIMIT
  let markerAdded = false

  const visit = (value: Prisma.JsonValue): Prisma.JsonValue => {
    if (typeof value === 'string') {
      if (remaining <= 0) {
        if (markerAdded) return ''
        markerAdded = true
        return TRUNCATION_MARKER
      }
      if (value.length <= remaining) {
        remaining -= value.length
        return value
      }

      const available = Math.max(0, remaining - TRUNCATION_MARKER.length)
      remaining = 0
      markerAdded = true
      return `${value.slice(0, available)}${TRUNCATION_MARKER}`
    }

    if (Array.isArray(value)) {
      return value.map((item) => visit(item))
    }

    if (value !== null && typeof value === 'object') {
      const result: Prisma.JsonObject = {}
      for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) result[key] = visit(item)
      }
      return result
    }

    return value
  }

  return visit(playbook)
}

export async function getHelloPayload(ctx: McpAuthContext) {
  const where: Prisma.ProjectWhereInput = {
    status: 'Normal',
    ...getProjectListingWhere(ctx.user.id, ctx.agentId),
  }
  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      title: true,
      playbook: true,
      ai_custom_instructions: {
        select: {
          customInstruction: true,
        },
        take: 1,
      },
    },
    orderBy: {
      title: 'asc',
    },
    take: BOARD_LIMIT + 1,
  })

  const boardsTruncated = projects.length > BOARD_LIMIT
  const visibleProjects = projects.slice(0, BOARD_LIMIT)
  const boards = visibleProjects.map((project) => ({
    id: project.id,
    name: project.name,
    title: project.title ?? project.name,
    boardUrl: `https://app.hypertask.ai/project?id=${project.id}`,
    taskUrlTemplate: `https://app.hypertask.ai/detail/project-${project.id}/{taskNumber}`,
  }))

  const conventions: Array<{
    projectId: number
    boardTitle: string
    playbook: Prisma.JsonValue | null
    instructions: string | null
  }> = []
  let conventionsSize = 0
  let conventionsTruncated = false

  for (const project of visibleProjects) {
    const rawInstructions =
      project.ai_custom_instructions[0]?.customInstruction?.trim() ?? ''
    const hasPlaybook = project.playbook !== null
    const hasInstructions = rawInstructions.length > 0
    if (!hasPlaybook && !hasInstructions) continue

    const entry = {
      projectId: project.id,
      boardTitle: project.title ?? project.name,
      playbook: hasPlaybook ? truncatePlaybook(project.playbook) : null,
      instructions: hasInstructions ? truncateText(rawInstructions) : null,
    }
    const entrySize = JSON.stringify(entry).length
    if (conventionsSize + entrySize > CONVENTIONS_TOTAL_LIMIT) {
      conventionsTruncated = true
      break
    }

    conventions.push(entry)
    conventionsSize += entrySize
  }

  return {
    user: {
      id: ctx.user.id,
      displayName: ctx.user.displayName ?? null,
      email: ctx.user.email,
    },
    boards,
    urlFormats: HELLO_URL_FORMATS,
    boardsTotal: projects.length,
    boardsTruncated,
    capabilities: await helloCapabilities(ctx.user.id),
    conventions,
    conventionsTruncated,
    ...(await helloGuidedStart(ctx, where)),
  }
}

export async function handleHelloRequest(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) return createUnauthorizedResponse()

    const payload = await getHelloPayload(ctx)
    return NextResponse.json({ success: true, ...payload })
  } catch (error) {
    console.error('[MCP Hello] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
