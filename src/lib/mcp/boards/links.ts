import { env as appEnv } from "#env";
/** Base URL for absolute MCP response links (matches internal fetch patterns). */
export function mcpPublicBaseUrl(): string {
  return (
    appEnv.NEXT_PUBLIC_BASEURL ||
    (appEnv.VERCEL_URL ? `https://${appEnv.VERCEL_URL}` : 'http://localhost:3000')
  )
}

export function buildMcpBoardUrl(projectId: number): string {
  const base = mcpPublicBaseUrl().replace(/\/$/, '')
  return `${base}/project?id=${projectId}`
}

/** In-app task URLs use uniqueIndex, not DB task id. */
export function buildMcpTaskUrl(projectId: number, uniqueIndex: number): string {
  const base = mcpPublicBaseUrl().replace(/\/$/, '')
  return `${base}/detail/project-${projectId}/${uniqueIndex}`
}
