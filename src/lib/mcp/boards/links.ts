export function mcpPublicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASEURL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  )
}

export function buildMcpBoardUrl(projectId: number): string {
  const base = mcpPublicBaseUrl().replace(/\/$/, '')
  return `${base}/project?id=${projectId}`
}

export function buildMcpTaskUrl(projectId: number, uniqueIndex: number): string {
  const base = mcpPublicBaseUrl().replace(/\/$/, '')
  return `${base}/detail/project-${projectId}/${uniqueIndex}`
}
