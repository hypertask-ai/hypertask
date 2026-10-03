import { z } from 'zod'
import { CONSOLIDATED_TOOL_DESCRIPTIONS } from './config/consolidated-descriptions'
import parameterDocs from './config/descriptions/parameters.json'
import { hasDataPermission, hasManagementReadPermission, hasManagementWritePermission, type ManagementPermissions } from '@/lib/mcp/managementPermissions'
import type { PortableTool } from './stateless-http'
import { CONSOLIDATED_OUTPUT_SCHEMA, formatToolResponse } from './tool-response'
import { createMetaTools } from './deferred-tools'

export type ToolCaller = { managementPermissions?: ManagementPermissions; agent?: boolean; teamScoped?: boolean }
type Action = { tool: string; legacy_action?: string; read_only: boolean; permission: string }
type Description = { name: string; does: string; use_when: string; do_not_use_when: string; parameters_and_caveats: string; actions: Record<string, Action>; input_examples: unknown[] }

const RENAMED_PARAMETERS: Record<string, string> = {
  viewId: 'view_id', displayName: 'display_name', photoURL: 'photo_url',
  user: 'user_id', userToAdd: 'member_identifier', sectionId: 'section_id',
  assignee: 'assignee_ids', task: 'task_identifier', board: 'project_id',
}

function canCall(action: Action, caller: ToolCaller): boolean {
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

function inputSchema(tool: PortableTool, action: Action): Record<string, unknown> {
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
  return schema
}

function legacyArguments(input: Record<string, unknown>, action: Action, tool: PortableTool): Record<string, unknown> {
  const shape = tool.parameters.shape
  const args = Object.fromEntries(Object.entries(input).map(([key, value]) => {
    const original = Object.keys(shape).find((field) => RENAMED_PARAMETERS[field] === key) ?? key
    return [original, value]
  }))
  if (action.legacy_action) args.action = action.legacy_action
  return args
}

export function selectMcpTools(
  legacyTools: readonly PortableTool[],
  enabled: boolean,
  caller: ToolCaller = {},
): readonly PortableTool[] {
  if (!enabled) return legacyTools
  const byName = new Map(legacyTools.map((tool) => [tool.name, tool]))
  const definitions = CONSOLIDATED_TOOL_DESCRIPTIONS as Description[]
  const dispatch = async (action: Action, input: unknown, token: string, invocation?: Parameters<PortableTool['execute']>[2]) => {
    if (!canCall(action, caller)) throw new Error('This action is not allowed by this credential. Reconnect with the required scope or a human account.')
    const tool = byName.get(action.tool)
    if (!tool) throw new Error('This action is unavailable. Refresh the tool catalog before retrying.')
    return tool.execute(input, token, invocation)
  }
  const catalog: PortableTool[] = definitions.flatMap((definition) => {
    const actions = Object.fromEntries(Object.entries(definition.actions).filter(([, action]) => canCall(action, caller)))
    const names = Object.keys(actions)
    if (!names.length) return []
    const sameNameLegacy = byName.get(definition.name)
    const legacyShape = sameNameLegacy ? Object.fromEntries(Object.entries(sameNameLegacy.parameters.shape).filter(([key]) => key !== 'action').map(([key, schema]) => [key, z.optional(schema as z.ZodType)])) : {}
    const parameters = z.object({
      ...legacyShape,
      action: z.enum(names as [string, ...string[]]).describe('Operation to perform on this resource.'),
      input: z.record(z.string(), z.unknown()).default({}).describe('Action-specific fields documented in the corresponding input schema.'),
      response_format: z.enum(['concise', 'detailed']).default('concise').describe('Concise summarizes reads; detailed includes full fields. Writes always retain their receipts.'),
      limit: z.number().int().min(1).max(50).default(20).describe('Maximum rows per read collection; default 20, maximum 50.'),
      offset: z.number().int().min(0).default(0).describe('Rows to skip for paginated or locally bounded reads; default 0. Prefer an input cursor when supplied.'),
    }).strict()
    const baseSchema = z.toJSONSchema(parameters, { target: 'draft-7', io: 'input' }) as Record<string, unknown>
    delete baseSchema.$schema
    // Cached timer clients may still send flat fields; only advertise the new nested form.
    if (sameNameLegacy) {
      const properties = baseSchema.properties as Record<string, unknown>
      for (const key of Object.keys(legacyShape)) delete properties[key]
    }
    const schema = {
      ...baseSchema,
      oneOf: names.map((name) => {
        const input = inputSchema(byName.get(actions[name].tool)!, actions[name])
        return {
          properties: { action: { const: name }, input },
          required: Array.isArray(input.required) && input.required.length ? ['action', 'input'] : ['action'],
        }
      }),
    }
    return [{
      name: definition.name,
      description: `Does: ${definition.does}\nUse when: ${definition.use_when}\nDo not use when: ${definition.do_not_use_when}\nParameters and caveats: ${definition.parameters_and_caveats}`,
      parameters,
      inputSchema: schema,
      outputSchema: CONSOLIDATED_OUTPUT_SCHEMA,
      input_examples: definition.input_examples.filter((example) => names.includes((example as { action: string }).action)),
      execute: async (raw: unknown, token: string, invocation?: Parameters<PortableTool['execute']>[2]) => {
        const args = parameters.parse(raw)
        const action = actions[args.action]
        const tool = byName.get(action.tool)!
        const oldArgs = raw as Record<string, unknown>
        const oldInput = Object.fromEntries(Object.keys(legacyShape).filter((key) => oldArgs[key] !== undefined).map((key) => [key, oldArgs[key]]))
        const input = { ...oldInput, ...legacyArguments(args.input, action, tool) }
        const supportsOffset = 'offset' in tool.parameters.shape
        const supportsLimit = 'limit' in tool.parameters.shape
        if (action.read_only && supportsLimit) {
          const limitSchema = z.toJSONSchema(tool.parameters.shape.limit, { unrepresentable: 'any', io: 'input' }) as { maximum?: number }
          input.limit = Math.min(Number(input.limit ?? args.limit), args.limit, limitSchema.maximum ?? 50)
        }
        if (action.read_only && supportsOffset) input.offset ??= args.offset
        try {
          // Validate the selected branch before any REST call; the old implementation retains its refinements.
          const validated = tool.parameters.parse(input)
          const text = await dispatch(action, validated, token, invocation)
          return formatToolResponse(text, args.response_format, action.read_only, args.limit, Number(input.offset ?? args.offset), supportsOffset)
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw new z.ZodError(error.issues.map((issue) => ({ ...issue, path: ['input', ...issue.path.map((field) => RENAMED_PARAMETERS[String(field)] ?? field)] })))
          }
          throw error
        }
      },
    }]
  })
  // Hidden aliases keep cached tool definitions callable across a flag change.
  // Preserve their argument and response shapes, including invocation idempotency.
  for (const tool of legacyTools) {
    if (catalog.some((entry) => entry.name === tool.name)) continue
    const actions = definitions.flatMap((definition) => Object.values(definition.actions)).filter((action) => action.tool === tool.name)
    if (!actions.length) throw new Error(`Legacy tool ${tool.name} is missing from the consolidated catalog`)
    catalog.push({
      ...tool,
      hidden: true,
      outputSchema: { type: 'object', additionalProperties: true },
      execute: async (raw, token, invocation) => {
        const requested = (raw as Record<string, unknown>)?.action
        const action = actions.find((candidate) => candidate.legacy_action === requested) ?? actions[0]
        return dispatch(action, raw, token, invocation)
      },
    })
  }
  catalog.push(...createMetaTools(() => catalog).map((tool) => ({
    ...tool, hidden: true, outputSchema: { type: 'object', additionalProperties: true },
  })))
  return catalog
}
