import { z } from 'zod'
import {
  DESCRIBE_TOOL_NAME,
  SEARCH_TOOLS_NAME,
  TOOL_SUMMARIES,
} from './config/tool-summaries'
import { TOOL_OUTPUT_SCHEMA, withSharedDefs } from './schema-defs'

type CatalogTool = {
  name: string
  description: string
  parameters: z.ZodObject<z.ZodRawShape>
  execute: (
    args: unknown,
    token: string,
    invocation?: { requestId: string; clientFingerprint: string; sessionId?: string }
  ) => Promise<string>
}

export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

export function firstSentence(text: string): string {
  const paragraph = (text.split(/\n\n/, 1)[0] ?? text).trim()
  const sentence = paragraph.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() ?? paragraph
  return sentence.length <= 100 ? sentence : sentence.slice(0, 99).trimEnd()
}

export function jsonSchemaFor(parameters: z.ZodType): Record<string, unknown> {
  try {
    const schema = z.toJSONSchema(parameters, { target: 'draft-7' }) as Record<string, unknown>
    delete schema.$schema
    return schema
  } catch {
    return { type: 'object', additionalProperties: true }
  }
}

export type ListedTool = {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

const META_LIST_SCHEMAS: Record<string, Record<string, unknown>> = {
  [SEARCH_TOOLS_NAME]: {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'integer' } },
    required: ['query'],
  },
  [DESCRIBE_TOOL_NAME]: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
}

export function listToolsDeferred(tools: readonly CatalogTool[]): ListedTool[] {
  return tools.map((tool) => {
    const listed: ListedTool = {
      name: tool.name,
      description: firstSentence(tool.description),
    }
    const metaSchema = META_LIST_SCHEMAS[tool.name]
    if (metaSchema) listed.inputSchema = metaSchema
    return listed
  })
}

export function listToolsFull(tools: readonly CatalogTool[]): ListedTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: jsonSchemaFor(tool.parameters),
  }))
}

export function searchToolCatalog(
  tools: readonly CatalogTool[],
  query: string,
  limit = 20
): Array<{ name: string; description: string }> {
  const needle = query.trim().toLowerCase()
  const ranked = tools
    .map((tool) => {
      const name = tool.name.toLowerCase()
      const description = tool.description.toLowerCase()
      const nameHit = needle.length === 0 || name.includes(needle)
      const descHit = needle.length > 0 && description.includes(needle)
      if (!nameHit && !descHit) return null
      const score = nameHit && needle.length > 0 ? 0 : 1
      return { name: tool.name, description: firstSentence(tool.description), score }
    })
    .filter((row): row is { name: string; description: string; score: number } => row !== null)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(limit, 50)))

  return ranked.map(({ name, description }) => ({ name, description }))
}

export function describeToolCatalog(
  tools: readonly CatalogTool[],
  name: string
): Record<string, unknown> | null {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) return null
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: withSharedDefs(jsonSchemaFor(tool.parameters)),
    outputSchema: { ...TOOL_OUTPUT_SCHEMA },
  }
}

export function parseStructuredContent(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return undefined
  }
  return undefined
}

const searchParameters = z
  .object({
    query: z.string().describe('Words to match against tool names and descriptions'),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()

const describeParameters = z
  .object({
    name: z.string().describe('Exact tool name, for example hypertask_list_tasks'),
  })
  .strict()

export function createMetaTools(getCatalog: () => readonly CatalogTool[]): CatalogTool[] {
  const searchTools: CatalogTool = {
    name: SEARCH_TOOLS_NAME,
    description: `${TOOL_SUMMARIES.SEARCH_TOOLS}\n\nUse this when the client loaded only the meta tools. Match on name or description, then call ${DESCRIBE_TOOL_NAME} before the real tool.`,
    parameters: searchParameters,
    execute: async (args) => {
      const parsed = searchParameters.parse(args)
      return JSON.stringify({
        tools: searchToolCatalog(getCatalog(), parsed.query, parsed.limit),
      })
    },
  }

  const describeTool: CatalogTool = {
    name: DESCRIBE_TOOL_NAME,
    description: `${TOOL_SUMMARIES.DESCRIBE_TOOL}\n\nCall this immediately before tools/call when the client has only the short catalog.`,
    parameters: describeParameters,
    execute: async (args) => {
      const parsed = describeParameters.parse(args)
      const described = describeToolCatalog(getCatalog(), parsed.name)
      if (!described) {
        return JSON.stringify({ error: `Unknown tool: ${parsed.name}` })
      }
      return JSON.stringify(described)
    },
  }

  return [searchTools, describeTool]
}

export function toolsForConnect(
  tools: readonly CatalogTool[],
  deferred: boolean
): readonly CatalogTool[] {
  if (!deferred) return tools
  if (tools.some((tool) => tool.name === SEARCH_TOOLS_NAME || tool.name === DESCRIBE_TOOL_NAME)) {
    return tools
  }
  const catalog: CatalogTool[] = [...tools]
  catalog.push(...createMetaTools(() => catalog))
  return catalog
}
