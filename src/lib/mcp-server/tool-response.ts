import { z } from 'zod'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import crypto from 'node:crypto'
import type { PortableTool } from './stateless-http'

export const CONSOLIDATED_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    data: { description: 'Action result; concise ticket rows contain id, ticket, title, status, assignee and due.' },
    response_format: { type: 'string', enum: ['concise', 'detailed'] },
    pagination: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        has_more: { type: 'boolean' },
        next_offset: { type: 'integer' },
        next_cursor: { type: 'string' },
        guidance: { type: 'string' },
        truncated: { type: 'boolean' },
      },
      required: ['limit', 'offset', 'has_more'],
    },
  },
  required: ['data', 'response_format'],
} as const

export function bindConsolidatedSseTools(server: McpServer, tools: readonly PortableTool[], sessionId: string): void {
  if (!tools.some((tool) => tool.inputSchema)) return
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.filter((tool) => !tool.hidden).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: 'object' },
      outputSchema: tool.outputSchema as { type: 'object' },
      ...(tool.input_examples?.length ? { input_examples: tool.input_examples } : {}),
    })),
  }))
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find((candidate) => candidate.name === request.params.name)
    if (!tool) return toolErrorResult(new Error('Unknown tool. Refresh tools/list and choose an advertised tool name'))
    const token = extra.authInfo?.token
    if (!token) return toolErrorResult(new Error('Missing MCP bearer token'))
    return executeToolResult(tool, request.params.arguments ?? {}, token, {
      requestId: String(extra.requestId), sessionId,
      clientFingerprint: crypto.createHash('sha256').update(token).digest('hex'),
    })
  })
}

export function actionableToolError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 4).map((issue) => {
      const field = issue.path.join('.') || 'input'
      if (/project_id (?:is required|must be provided).*unique_index|unique_index.*(?:requires|must).*project_id/.test(issue.message)) {
        return 'project_id is required when unique_index is given; pass the project id or use ticket_number.'
      }
      if (issue.code === 'unrecognized_keys') {
        return `Remove unsupported fields ${issue.keys.join(', ')} from ${field}; use only fields documented for this action.`
      }
      return `Change ${field}: ${issue.message.replace(/[.!]$/, '')}. Pass a value matching this action's input schema.`
    }).join(' ')
  }
  const detail = error as { code?: number; httpStatus?: number; message?: string }
  if (detail?.code === -32001 || /missing.*token/i.test(detail?.message ?? '')) {
    return 'Authentication failed. Reconnect the MCP connector and retry with a valid bearer token.'
  }
  if (detail?.code === -32003) {
    return 'Access denied. Use a credential with the required scope and confirm membership in the target board.'
  }
  if (detail?.code === -32004) {
    return 'Resource not found. Check the identifier with a targeted list or search using the same credential.'
  }
  if (detail?.httpStatus === 429) {
    return 'Rate limit reached. Wait for the retry interval, then make fewer and more targeted calls.'
  }
  if (detail?.code === -32603 || /stack|prisma|sql|exception|internal|fetch failed/i.test(detail?.message ?? '')) {
    return 'The service could not complete this action. Retry a read later; before retrying a write, check whether it already succeeded.'
  }
  const message = (detail?.message ?? '').replace(/^Error:\s*/i, '').trim()
  if (!message) return 'The tool could not complete this action. Check the action and its required input fields, then retry.'
  // Never echo credentials or an upstream response body in model-facing errors.
  const safe = message.replace(/(?:Bearer\s+\S+|\b(?:htmk_|htk_)[\w-]+|\beyJ[\w.-]+)/gi, '[redacted]').slice(0, 600)
  if (/unique_index.*project_id|project_id.*unique_index/.test(safe)) {
    return 'project_id is required when unique_index is given; pass the project id or use ticket_number.'
  }
  return `${safe.replace(/[.!]$/, '')}. Check the action's required parameters and permissions before retrying.`
}

export function toolErrorResult(error: unknown): CallToolResult {
  return { content: [{ type: 'text', text: actionableToolError(error) }], isError: true }
}

export async function executeToolResult(
  tool: PortableTool,
  args: unknown,
  token: string,
  invocation?: Parameters<PortableTool['execute']>[2],
): Promise<CallToolResult> {
  try {
    const parsed = tool.parameters.parse(args)
    const text = await tool.execute(parsed, token, invocation)
    if (/^Error:/i.test(text)) return toolErrorResult(new Error(text))
    let structured: Record<string, unknown> | undefined
    let value: unknown
    try { value = JSON.parse(text) } catch { /* Some legacy tools return plain text. */ }
    if (value && typeof value === 'object') {
      structured = Array.isArray(value) ? { items: value } : value as Record<string, unknown>
      const failure = structured.data && typeof structured.data === 'object' ? structured.data as Record<string, unknown> : structured
      if (failure.success === false || failure.error) {
        const result = toolErrorResult(new Error(typeof failure.error === 'string' ? failure.error : String(failure.message ?? 'The action failed')))
        if (Array.isArray(failure.attachments) || failure.task) {
          const receipt = Object.fromEntries(['success', 'task', 'attachments', 'attachment_status', 'cleanup_confirmed'].filter((key) => key in failure).map((key) => [key, failure[key]]))
          receipt.error = (result.content[0] as { text: string }).text
          if (failure.retry_note) receipt.retry_note = actionableToolError(new Error(String(failure.retry_note)))
          if (Array.isArray(failure.failed_files)) receipt.failed_files = failure.failed_files.map((file) => ({ index: file?.index, filename: file?.filename, error: actionableToolError(new Error(String(file?.error ?? 'Attachment upload failed'))) }))
          const output = structured === failure ? receipt : { ...structured, data: receipt }
          return { ...result, ...(tool.outputSchema ? { structuredContent: output } : {}), content: [...result.content, { type: 'text', text: JSON.stringify(output) }] }
        }
        return result
      }
    }
    return {
      content: [{ type: 'text', text }],
      ...(tool.outputSchema && structured ? { structuredContent: structured } : {}),
    }
  } catch (error) {
    return toolErrorResult(error)
  }
}

function conciseValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(conciseValue)
  if (!value || typeof value !== 'object') return value
  const row = value as Record<string, unknown>
  if ('content' in row && (row.type === 'task' || row.type === 'comment')) {
    return { type: row.type, task_id: row.taskId, comment_id: row.commentId, project_id: row.projectId, ticket: row.ticketNumber, title: row.title, text: row.content, updated_at: row.updatedAt, created_at: row.createdAt }
  }
  if (typeof row.content === 'string' && typeof row.url === 'string') {
    return { title: row.title, url: row.url, text: row.content.slice(0, 2000), ...(row.content.length > 2000 ? { truncated: true, guidance: 'Use response_format=detailed to read the full document.' } : {}) }
  }
  if (row.ticketNumber || row.ticket_number || ('title' in row && ('section' in row || 'boardId' in row))) {
    return {
      id: row.id ?? row.taskId ?? null,
      ticket: row.ticketNumber ?? row.ticket_number ?? null,
      title: row.title ?? null,
      status: row.section ?? row.status ?? null,
      assignee: row.assignees ?? row.assignee ?? (row.assigneeCount !== undefined ? { count: row.assigneeCount } : []),
      due: row.dueDate ?? row.due_date ?? null,
      ...Object.fromEntries(['children', 'sub_tasks', 'relationType', 'direction'].filter((key) => key in row).map((key) => [key, conciseValue(row[key])])),
    }
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(row)) {
    if (['description', 'descriptionJson', 'content', 'body_html', 'link', 'photoURL', 'sectionId', 'boardId', 'createdBy', 'permanentlyDeleteAt'].includes(key)) continue
    result[key] = conciseValue(item)
  }
  return result
}

export function formatToolResponse(
  text: string,
  format: 'concise' | 'detailed',
  readOnly: boolean,
  limit: number,
  offset: number,
  serverPaginated: boolean,
): string {
  if (/^Error:/i.test(text)) throw new Error(text)
  let data: unknown
  try { data = JSON.parse(text) } catch { data = { message: text } }
  const original = data as Record<string, unknown> | null
  let hasMore = false
  let truncated = false
  let returnedRows = 0
  // Bound collections, not nested write receipts or evidence passages.
  function bound(value: unknown, depth = 0): unknown {
    if (Array.isArray(value)) {
      const start = depth <= 1 && !serverPaginated ? offset : 0
      const rows = value.slice(start, start + limit)
      if (value.length > start + limit) {
        if (depth <= 1) hasMore = true
        truncated = true
      }
      if (depth <= 1) returnedRows = Math.max(returnedRows, rows.length)
      return rows.map((row) => bound(row, depth + 1))
    }
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bound(item, depth + 1)]))
  }
  if (readOnly) data = bound(data)
  if (readOnly && format === 'concise') data = conciseValue(data)
  hasMore ||= original?.has_more === true || Boolean(original?.nextCursor)
  const nextCursor = original?.nextCursor ?? original?.next_cursor
  return JSON.stringify({
    data,
    response_format: readOnly ? format : 'detailed',
    ...(readOnly ? {
      pagination: {
        limit,
        offset,
        has_more: hasMore,
        ...(hasMore && returnedRows > 0 ? { next_offset: offset + returnedRows } : {}),
        ...(truncated || original?.truncated === true ? { truncated: true } : {}),
        ...(typeof nextCursor === 'string' ? { next_cursor: nextCursor } : {}),
        ...(hasMore || truncated || original?.truncated === true ? { guidance: 'Prefer many small, targeted searches using project, section, date or assignee filters. Continue with next_cursor or next_offset when supported; narrow filters for truncated nested collections.' } : {}),
      },
    } : {}),
  })
}
