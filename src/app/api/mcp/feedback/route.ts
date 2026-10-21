import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, mcpUnauthorizedResponse } from '@/lib/mcp/auth'
import { AiFeedbackError, fileAiFeedback } from '@/lib/aiFeedback/report'

export async function POST(request: NextRequest) {
  const ctx = await validateMcpAuth(request, { deferManagementPermissionCheck: true })
  if (!ctx) return mcpUnauthorizedResponse(request)
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json(await fileAiFeedback(body, ctx.user.id, { origin: 'agent', agentName: ctx.agentDisplayName }))
  } catch (error) {
    if (error instanceof AiFeedbackError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    return NextResponse.json({ success: false, error: 'Unable to file AI feedback' }, { status: 503 })
  }
}
