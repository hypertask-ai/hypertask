import { z } from 'zod'
import { CONSOLIDATED_TOOL_DESCRIPTIONS } from './config/consolidated-descriptions'
import parameterDocs from './config/descriptions/parameters.json'
import { hasDataPermission, hasManagementReadPermission, hasManagementWritePermission, type ManagementPermissions } from '@/lib/mcp/managementPermissions'
import type { PortableTool } from './stateless-http'
import { CONSOLIDATED_OUTPUT_SCHEMA, formatToolResponse } from './tool-response'
import { createMetaTools } from './deferred-tools'
import { annotationsForActions } from './config/tool-annotations'
import type { AgentRole } from '@/lib/mcp/agents/scopes'

export type ToolCaller = { managementPermissions?: ManagementPermissions; agent?: boolean; teamScoped?: boolean; agentRole?: AgentRole }
type Action = { tool: string; legacy_action?: string; read_only: boolean; permission: string }
type Description = { name: string; does: string; use_when: string; do_not_use_when: string; parameters_and_caveats: string; actions: Record<string, Action>; input_examples: unknown[] }

const RENAMED_PARAMETERS: Record<string, string> = {
  viewId: 'view_id', displayName: 'display_name', photoURL: 'photo_url',
  user: 'user_id', userToAdd: 'member_identifier', sectionId: 'section_id',
  assignee: 'assignee_ids', task: 'task_identifier', board: 'project_id',
}

function canCall(action: Action, caller: ToolCaller): boolean {
  if (action.permission === 'feedback') return true
  if (caller.agentRole === 'read' && !action.read_only) return false
  const permissions = caller.managementPermissions
  if (caller.teamScoped && ['hypertask_mint_token', 'hypertask_revoke_token', 'hypertask_list_connections'].includes(action.tool)) return false
  if (action.permission.startsWith('management_')) {
    if (caller.agent) return false
    if (!permissions) return true
    return action.permission === 'management_read'
      ? hasManagementReadPermission(permissions)
      : hasManagementWritePermission(permissions)
  }
  if (action.permission === 'human_data' && caller.agent) return false
  return !permissions || hasDataPermission(permissions)
}

function inputSchema(tool: PortableTool, action: Action, boardAlias = false): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.parameters, { target: 'draft-7', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>
  delete schema.$schema
  const properties = schema.properties as Record<string, unknown>
  schema.properties = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== 'action' || !action.legacy_action).map(([key, value]) => [RENAMED_PARAMETERS[key] ?? key, value]))
  if (Array.isArray(schema.required)) schema.required = schema.required.filter((key) => key !== 'action' || !action.legacy_action).map((key) => RENAMED_PARAMETERS[String(key)] ?? key)
  function document(value: unknown) {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (typeof node.description === 'string') node.description = node.description.replace(/\u2014/g, ';')
    if (node.properties) {
      for (const [key, child] of Object.entries(node.properties as Record<string, Record<string, unknown>>)) {
        child.description ??= (parameterDocs as Record<string, string>)[key] ?? `The ${key.replace(/_/g, ' ')} value for this operation.`
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(document)
      else document(child)
    }
  }
  document(schema)
  const inputProperties = schema.properties as Record<string, unknown>
  if (boardAlias && inputProperties.project_id) {
    inputProperties.board_id = { ...(inputProperties.project_id as Record<string, unknown>), description: 'Alias for project_id.' }
    if (Array.isArray(schema.required) && schema.required.includes('project_id')) {
      schema.required = schema.required.filter((key) => key !== 'project_id')
      schema.anyOf = [{ required: ['project_id'] }, { required: ['board_id'] }]
    }
  }
  return schema
}

const TOP_LEVEL_FIELDS = new Set(['action', 'input', 'response_format', 'limit', 'offset', 'page'])

function hoistTopLevelInputFields(
  raw: unknown,
  actions: Record<string, Action>,
  byName: Map<string, PortableTool>,
  legacyShape: Record<string, unknown>,
): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const requested = (raw as Record<string, unknown>).action
  const action = typeof requested === 'string' ? actions[requested] : undefined
  const tool = action ? byName.get(action.tool) : undefined
  if (!tool) return raw
  const rawFields = raw as Record<string, unknown>
  const nested = rawFields.input
  if (nested !== undefined && (typeof nested !== 'object' || nested === null || Array.isArray(nested))) return raw
  const input = { ...(nested as Record<string, unknown> | undefined) }
  const documented = new Set(Object.keys(tool.parameters.shape).map((field) => RENAMED_PARAMETERS[field] ?? field))
  const hoisted = { ...rawFields }
  for (const [key, value] of Object.entries(rawFields)) {
    if (TOP_LEVEL_FIELDS.has(key) || key in legacyShape || !documented.has(key)) continue
    if (input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(value)) {
      throw new z.ZodError([{ code: 'custom', path: ['input', key], message: `Pass ${key} inside input or at the top level, not both with different values.` }])
    }
    input[key] = value
    delete hoisted[key]
  }
  hoisted.input = input
  return hoisted
}

function legacyArguments(input: Record<string, unknown>, action: Action, tool: PortableTool, taskNumberAlias = false): Record<string, unknown> {
  const shape = tool.parameters.shape
  const args = Object.fromEntries(Object.entries(input).map(([key, value]) => {
    const original = Object.keys(shape).find((field) => RENAMED_PARAMETERS[field] === key) ?? key
    return [original, value]
  }))
  if (taskNumberAlias && 'ticket_number' in shape && 'task_number' in args) {
    const alias = args.task_number
    delete args.task_number
    if (args.ticket_number === undefined) args.ticket_number = alias
    else if (String(args.ticket_number) !== String(alias)) throw new z.ZodError([{ code: 'custom', path: ['task_number'], message: 'Pass either ticket_number or task_number, not both with different values.' }])
  }
  if (action.legacy_action) args.action = action.legacy_action
  return args
}

export function selectMcpTools(
  legacyTools: readonly PortableTool[],
  enabled: boolean,
  caller: ToolCaller = {},
  v2 = false,
  flatSchema = false,
  pageAlias = false,
  taskNumberAlias = false,
  boardAlias = false,
  topLevelInputFields = false,
): readonly PortableTool[] {
  if (!enabled) {
    if (!v2) return legacyTools
    return legacyTools.flatMap((tool) => {
      const actions = (CONSOLIDATED_TOOL_DESCRIPTIONS as Description[]).flatMap((definition) => Object.values(definition.actions)).filter((action) => action.tool === tool.name)
      const allowed = actions.filter((action) => canCall(action, caller))
      if (!allowed.length) return []
      const names = allowed.map((action) => action.legacy_action).filter((name): name is string => Boolean(name))
      const restricted = allowed.length !== actions.length
      return [{
        ...tool,
        annotations: annotationsForActions(allowed),
        ...(restricted && names.length ? { parameters: tool.parameters.extend({ action: z.enum(names as [string, ...string[]]) }) } : {}),
        execute: async (raw: unknown, token: string, invocation?: Parameters<PortableTool['execute']>[2]) => {
          const requested = (raw as Record<string, unknown>)?.action
          const action = actions.find((candidate) => candidate.legacy_action === requested) ?? actions[0]
          if (!canCall(action, caller)) throw new Error('This action is not allowed by this credential. Reconnect with the required scope or a human account.')
          return tool.execute(raw, token, invocation)
        },
      }]
    })
  }
  const byName = new Map(legacyTools.map((tool) => [tool.name, tool]))
  const definitions = CONSOLIDATED_TOOL_DESCRIPTIONS as Description[]
  const dispatch = async (action: Action, input: unknown, token: string, invocation?: Parameters<PortableTool['execute']>[2]) => {
    if (!canCall(action, caller)) throw new Error('This action is not allowed by this credential. Reconnect with the required scope or a human account.')
    const tool = byName.get(action.tool)
    if (!tool) throw new Error('This action is unavailable. Refresh the tool catalog before retrying.')
    return tool.execute(input, token, invocation)
  }
  const catalog: PortableTool[] = definitions.flatMap((definition) => {
    const actions = Object.fromEntries(Object.entries(definition.actions).filter(([, action]) => byName.has(action.tool) && canCall(action, caller)))
    const names = Object.keys(actions)
    const boardAliasEnabled = boardAlias && (definition.name === 'hypertask_tasks' || definition.name === 'hypertask_comments')
    if (!names.length) return []
    const sameNameLegacy = byName.get(definition.name)
    const legacyShape = sameNameLegacy ? Object.fromEntries(Object.entries(sameNameLegacy.parameters.shape).filter(([key]) => key !== 'action').map(([key, schema]) => [key, z.optional(schema as z.ZodType)])) : {}
    const parameters = z.object({
      ...legacyShape,
      action: (definition.name === 'hypertask_report_feedback' ? z.enum(names as [string, ...string[]]).default('report') : z.enum(names as [string, ...string[]])).describe('Operation to perform on this resource.'),
      input: z.record(z.string(), z.unknown()).default({}).describe('Action-specific fields documented in the corresponding input schema.'),
      response_format: z.enum(['concise', 'detailed']).default('concise').describe('Concise summarizes reads; detailed includes full fields. Writes always retain their receipts.'),
      limit: z.number().int().min(1).max(50).default(20).describe('Maximum rows per read collection; default 20, maximum 50.'),
      offset: z.number().int().min(0).default(0).describe('Rows to skip for paginated or locally bounded reads; default 0. Prefer an input cursor when supplied.'),
      ...(pageAlias ? { page: z.number().int().min(1).optional().describe('1-based page number; page 1 is the first page. An offset that equals the page start is accepted; any other offset is refused.') } : {}),
    }).strict()
    const baseSchema = z.toJSONSchema(parameters, { target: 'draft-7', io: 'input' }) as Record<string, unknown>
    delete baseSchema.$schema
    if (sameNameLegacy) {
      const properties = baseSchema.properties as Record<string, unknown>
      for (const key of Object.keys(legacyShape)) delete properties[key]
    }
    const properties = baseSchema.properties as Record<string, Record<string, unknown>>
    const schema = flatSchema ? {
      ...baseSchema,
      required: ['action'],
      properties: {
        ...properties,
        input: {
          type: 'object',
          description: `${properties.input.description} Fields depend on action; use the variant whose title is the action.`,
          anyOf: names.map((name) => ({ title: name, ...inputSchema(byName.get(actions[name].tool)!, actions[name], boardAliasEnabled) })),
        },
      },
    } : {
      ...baseSchema,
      oneOf: names.map((name) => {
        const input = inputSchema(byName.get(actions[name].tool)!, actions[name], boardAliasEnabled)
        return {
          properties: { action: { const: name }, input },
          required: (Array.isArray(input.required) && input.required.length) || input.anyOf ? ['action', 'input'] : ['action'],
        }
      }),
    }
    return [{
      name: definition.name,
      description: `Does: ${definition.does}\nUse when: ${definition.use_when}\nDo not use when: ${definition.do_not_use_when}\nParameters and caveats: ${definition.parameters_and_caveats}${boardAliasEnabled ? ' board_id is an alias for project_id.' : ''}`,
      parameters,
      inputSchema: schema,
      ...(v2 ? { annotations: annotationsForActions(Object.values(actions)) } : {}),
      outputSchema: CONSOLIDATED_OUTPUT_SCHEMA,
      input_examples: definition.input_examples.filter((example) => names.includes((example as { action: string }).action)),
      ...(topLevelInputFields ? { normalizeArguments: (raw: unknown) => hoistTopLevelInputFields(raw, actions, byName, legacyShape) } : {}),
      execute: async (raw: unknown, token: string, invocation?: Parameters<PortableTool['execute']>[2]) => {
        const rawArgs = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
        const args = parameters.parse(raw)
        const action = actions[args.action]
        const tool = byName.get(action.tool)!
        const oldArgs = rawArgs
        const oldInput = Object.fromEntries(Object.keys(legacyShape).filter((key) => oldArgs[key] !== undefined).map((key) => [key, oldArgs[key]]))
        const input = { ...oldInput, ...legacyArguments(args.input, action, tool, taskNumberAlias) }
        const supportsOffset = 'offset' in tool.parameters.shape
        const supportsLimit = 'limit' in tool.parameters.shape
        const supportsCursor = 'cursor' in tool.parameters.shape
        const inputIssues = (error: z.ZodError) => new z.ZodError(error.issues.map((issue) => ({ ...issue, path: ['input', ...issue.path.map((field) => RENAMED_PARAMETERS[String(field)] ?? field)] })))
        const requestedPage = pageAlias && typeof args.page === 'number' ? args.page : undefined
        if (requestedPage !== undefined && input.cursor !== undefined) {
          throw new z.ZodError([{ code: 'custom', path: ['page'], message: 'Pass either page or cursor, not both.' }])
        }
        const cursorPaginated = supportsCursor && Boolean(input.cursor)
        let readLimit = args.limit
        let maximum: number | undefined
        let endpointCap: number | undefined
        try {
          if (boardAliasEnabled && 'board_id' in input) {
            if (input.project_id !== undefined && Number(input.board_id) !== Number(input.project_id)) {
              throw new z.ZodError([{ code: 'custom', path: ['board_id'], message: 'board_id and project_id must identify the same board when both are provided.' }])
            }
            if (input.project_id === undefined) input.project_id = input.board_id
            delete input.board_id
          }
          if (action.read_only && supportsLimit) {
            const requestedLimit = input.limit === undefined ? args.limit : Number(z.object({ limit: tool.parameters.shape.limit }).parse({ limit: input.limit }).limit)
            const limitSchema = z.toJSONSchema(tool.parameters.shape.limit, { unrepresentable: 'any', io: 'input' }) as { maximum?: number }
            maximum = limitSchema.maximum ?? 50
            readLimit = Math.min(requestedLimit, args.limit, maximum)
          }
        } catch (error) {
          if (error instanceof z.ZodError) throw inputIssues(error)
          throw error
        }
        const topLevelOffset = Number(args.offset)
        const suppliedOffset = input.offset === undefined ? topLevelOffset : Number(input.offset)
        const pageOffset = requestedPage === undefined ? undefined : (requestedPage - 1) * readLimit
        const offsets = input.offset === undefined ? [topLevelOffset] : [topLevelOffset, suppliedOffset]
        if (pageOffset !== undefined && offsets.some((offset) => offset !== 0 && offset !== pageOffset)) {
          throw new z.ZodError([{ code: 'custom', path: ['page'], message: 'Pass either page or offset, not both.' }])
        }
        try {
          const offset = cursorPaginated ? 0 : pageOffset ?? suppliedOffset
          if (maximum !== undefined) {
            const prefix = supportsOffset || cursorPaginated ? 0 : offset
            const lookahead = !supportsOffset && !supportsCursor ? 1 : 0
            input.limit = Math.min(readLimit + prefix + lookahead, maximum)
            if (lookahead) endpointCap = maximum
          }
          if (action.read_only && supportsOffset) input.offset = offset
          const validated = tool.parameters.parse(input)
          const text = await dispatch(action, validated, token, invocation)
          return formatToolResponse(text, args.response_format, action.read_only, readLimit, offset, supportsOffset || cursorPaginated, endpointCap)
        } catch (error) {
          if (error instanceof z.ZodError) throw inputIssues(error)
          throw error
        }
      },
    }]
  })
  for (const tool of legacyTools) {
    if (catalog.some((entry) => entry.name === tool.name)) continue
    const actions = definitions.flatMap((definition) => Object.values(definition.actions)).filter((action) => action.tool === tool.name)
    const allowed = v2 ? actions.filter((action) => canCall(action, caller)) : actions
    if (v2 && !allowed.length) continue
    const names = allowed.map((action) => action.legacy_action).filter((name): name is string => Boolean(name))
    if (!actions.length) throw new Error(`Legacy tool ${tool.name} is missing from the consolidated catalog`)
    catalog.push({
      ...tool,
      hidden: true,
      ...(v2 ? { annotations: annotationsForActions(allowed) } : {}),
      ...(v2 && allowed.length !== actions.length && names.length ? { parameters: tool.parameters.extend({ action: z.enum(names as [string, ...string[]]) }) } : {}),
      outputSchema: { type: 'object', additionalProperties: true },
      execute: async (raw, token, invocation) => {
        const requested = (raw as Record<string, unknown>)?.action
        const action = actions.find((candidate) => candidate.legacy_action === requested) ?? actions[0]
        return dispatch(action, raw, token, invocation)
      },
    })
  }
  catalog.push(...createMetaTools(() => catalog, v2).map((tool) => ({
    ...tool, hidden: true, outputSchema: { type: 'object', additionalProperties: true },
  })))
  return catalog
}
