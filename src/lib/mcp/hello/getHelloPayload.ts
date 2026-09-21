import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

import {
  checkMcpRateLimit,
  createUnauthorizedResponse,
  validateMcpAuth,
  type McpAuthContext,
} from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'

const BOARD_LIMIT = 50
const PER_BOARD_TEXT_LIMIT = 2000
const CONVENTIONS_TOTAL_LIMIT = 8 * 1024
const TRUNCATION_MARKER = '… [truncated]'

export const HELLO_CAPABILITIES = {
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
  const projects = await prisma.project.findMany({
    where: {
      status: 'Normal',
      ...getProjectListingWhere(ctx.user.id, ctx.agentId),
    },
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
    boardsTotal: projects.length,
    boardsTruncated,
    capabilities: HELLO_CAPABILITIES,
    conventions,
    conventionsTruncated,
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
