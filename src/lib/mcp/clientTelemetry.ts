import { createHash } from 'crypto'

export type McpCliIdentity = {
  client: 'hypertask-cli' | 'htz'
  version: string
}

type McpCliAuthContext = {
  user: { id: number }
  agentId: string | null
}

const CLI_USER_AGENT = /^(hypertask-cli|htz)\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/

export function identifyMcpCli(userAgent: string | null): McpCliIdentity | null {
  const match = userAgent?.match(CLI_USER_AGENT)
  if (!match) return null

  return {
    client: match[1] as McpCliIdentity['client'],
    version: match[2],
  }
}

export function logMcpCliUsage(
  request: Pick<Request, 'headers' | 'method' | 'url'>,
  token: string,
  context: McpCliAuthContext
): void {
  const identity = identifyMcpCli(request.headers.get('User-Agent'))
  if (!identity) return

  console.info('[MCP CLI Usage]', {
    event: 'mcp_cli_usage',
    ...identity,
    tokenFingerprint: createHash('sha256').update(token).digest('hex'),
    userId: context.user.id,
    agentId: context.agentId,
    method: request.method,
    path: new URL(request.url).pathname,
  })
}
