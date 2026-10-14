import { waitUntil } from '@vercel/functions'
import { ZodError } from 'zod'
import { aiFeedbackSchema, type AiFeedbackInput } from './input'
import type { McpAuthContext } from '@/lib/mcp/auth/types'
import type { PortableTool } from '@/lib/mcp-server/stateless-http'

export function queueAiFeedback(input: AiFeedbackInput, userId?: number): void {
  try {
    const report = { ...input, category: input.category ?? (input.status === 401 ? 'auth_failed' : input.errorCode === 'empty-tools-list' ? 'empty_result' : 'call_failed') }
    for (const field of ['tool', 'client', 'errorCode'] as const) {
      if (!aiFeedbackSchema.shape[field].safeParse(report[field]).success) delete report[field]
    }
    waitUntil(import('./report').then(({ fileAiFeedback }) => fileAiFeedback(report, userId)).catch(() => {}))
  } catch {
  }
}

export function feedbackRouteTemplate(pathname: string): string {
  const { MCP_FEEDBACK_ROUTE_TEMPLATES } = require('./routes') as typeof import('./routes')
  for (const template of MCP_FEEDBACK_ROUTE_TEMPLATES) {
    const parts = template.split('/')
    const input = pathname.replace(/^\/api\/v1\//, '/api/mcp/').split('/')
    if (parts.length === input.length && parts.every((part, index) => part.startsWith(':') || part === input[index])) return template
  }
  return '/api/mcp/unknown'
}

export function queueRestFailure(request: Request, status: number, auth?: McpAuthContext | null): void {
  if (status < 500 || status > 599) return
  const pathname = new URL(request.url).pathname
  if (pathname === '/api/mcp/feedback' || pathname === '/api/v1/feedback') return
  const tool = feedbackRouteTemplate(pathname)
  const cli = /^(?:hypertask-cli|hypertask|htz)\//i.test(request.headers.get('user-agent') ?? '')
  const input: AiFeedbackInput = { surface: cli ? 'cli' : 'api', ...(cli ? { client: 'hypertask-cli' } : {}), tool, status, errorCode: 'http-server-error' }
  if (auth) queueAiFeedback(input, auth.user.id)
  else {
    try {
      waitUntil(import('@/lib/mcp/auth').then(async ({ validateMcpAuth }) => {
        const { NextRequest } = await import('next/server')
        const ctx = await validateMcpAuth(new NextRequest(request.url, { headers: request.headers }))
        if (ctx) queueAiFeedback(input, ctx.user.id)
        else if (!request.headers.has('Authorization')) {
          const { getSessionUser } = await import('@/lib/auth/getSessionUser')
          const session = await getSessionUser(request.headers)
          if (session) queueAiFeedback(input, session.userId)
        }
      }).catch(() => {}))
    } catch {  }
  }
}

const MCP_ERROR_STATUS: Record<number, number> = { [-32001]: 401, [-32003]: 403, [-32004]: 404, [-32602]: 400 }

function feedbackStatus(value: unknown, depth = 0): number | undefined {
  if (depth >= 4 || !value || typeof value !== 'object') return undefined
  try {
    const result = value as Record<string, unknown>
    for (const key of ['status', 'statusCode', 'httpStatus']) {
      const status = result[key]
      if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) return status
    }
    const mcpStatus = typeof result.code === 'number' ? MCP_ERROR_STATUS[result.code] : undefined
    if (mcpStatus) return mcpStatus
    return feedbackStatus(result.data, depth + 1) ?? feedbackStatus(result.error, depth + 1)
  } catch {
    return undefined
  }
}

export function observeFeedbackTools(tools: readonly PortableTool[], userId: number): PortableTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (args, token, invocation) => {
      if (tool.name === 'hypertask_report_feedback') return tool.execute(args, token, invocation)
      try {
        const text = await tool.execute(args, token, invocation)
        let result: unknown
        try { result = JSON.parse(text) } catch {  }
        const status = feedbackStatus(result)
        if (status && status >= 500) queueAiFeedback({ surface: 'mcp', tool: tool.name, status, errorCode: 'tool-server-error' }, userId)
        return text
      } catch (error) {
        const status = error instanceof ZodError ? 400 : feedbackStatus(error) ?? 500
        queueAiFeedback({ surface: 'mcp', tool: tool.name, status, errorCode: 'tool-exception' }, userId)
        throw error
      }
    },
  }))
}
