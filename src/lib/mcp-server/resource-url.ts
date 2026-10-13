import { isAllowedAuthHost } from '@/lib/auth/requestBaseUrl'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7190_MCP_RESOURCE_HOST_FLAG } from '@/lib/flags/keys'

export const MCP_RESOURCE_URL =
  process.env.NEXT_PUBLIC_MCP_SERVER_URL || 'https://mcp.hypertask.ai/mcp'

export async function getMcpRequestOrigin(request: Request): Promise<string | undefined> {
  const requestUrl = new URL(request.url)
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || requestUrl.host)
    .split(',')[0].trim().toLowerCase()
  const proto = (request.headers.get('x-forwarded-proto') || requestUrl.protocol.slice(0, -1))
    .split(',')[0].trim().toLowerCase()

  if (proto !== 'http' && proto !== 'https') return undefined
  try {
    const origin = new URL(`${proto}://${host}`)
    if (origin.host !== host || origin.href !== `${proto}://${host}/`) return undefined
    if (
      host !== 'app.hypertask.ai' && host !== 'mcp.hypertask.ai' &&
      host !== new URL(MCP_RESOURCE_URL).host && !isAllowedAuthHost(host)
    ) return undefined

    // Discovery precedes login; Everyone/OFF can be evaluated without a user.
    if (!await isFeatureEnabled(HTPR_7190_MCP_RESOURCE_HOST_FLAG, 0)) return undefined
    return origin.origin
  } catch {
    return undefined
  }
}
