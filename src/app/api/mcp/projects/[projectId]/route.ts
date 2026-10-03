import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import { loadSessionUserRecord } from '@/lib/auth/sessionUserRecord'
import updateProject from '@/utils/controllers/projects/update'
import { broadcastBoardChange } from '@/lib/realtime/server'

/** PATCH /api/mcp/projects/:projectId with { title: string }. */
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const { projectId } = await props.params
    let body: { title?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body' },
        { status: 400 }
      )
    }
    const user = await loadSessionUserRecord(ctx.user.id)
    const result = await updateProject(Number(projectId), body?.title, undefined, undefined, user, ctx.agentId)
    if (result.status !== 200 || !('id' in result.json)) {
      const message = 'message' in result.json ? result.json.message : 'Unable to rename board'
      return NextResponse.json(
        { success: false, error: message, message },
        { status: result.status }
      )
    }

    void broadcastBoardChange(Number(projectId), { originUserId: user.id })
    const { id, title, name } = result.json
    return NextResponse.json({ success: true, project: { id, title, name } })
  } catch (error) {
    console.error('Error renaming board:', error)
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred while renaming the board' },
      { status: 500 }
    )
  }
}
