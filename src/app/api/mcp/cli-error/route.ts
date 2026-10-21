import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, mcpUnauthorizedResponse } from '@/lib/mcp/auth'
import { cliErrorReportSchema, reserveCliErrorReport } from '@/lib/cliErrorReport'

export async function POST(request: NextRequest) {
  const ctx = await validateMcpAuth(request, { deferManagementPermissionCheck: true })
  if (!ctx) return mcpUnauthorizedResponse(request)
  const parsed = cliErrorReportSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid CLI error report' }, { status: 400 })
  try {
    if (!await reserveCliErrorReport(ctx.user.id)) return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Unable to report CLI error' }, { status: 503 })
  }
  const { command, error, status, version, os } = parsed.data
  console.error(`[cli-error] ${command}: ${error}${status ? ` (HTTP ${status})` : ''} v${version} ${os}`)
  return new NextResponse(null, { status: 204 })
}
