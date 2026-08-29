import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth } from '@/lib/mcp/auth'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import { validateProjectMemberIds } from '@/lib/mcp/tasks/services'
import { ensureTaskMovedToInbox } from '@/lib/taskCardActions/inboxState'

interface MoveToInboxBody {
  task_id?: number | null
  ticket_number?: string | null
  unique_index?: number | null
  project_id?: number | null
  user_id?: number
}

/**
 * POST /api/mcp/inbox/move
 *
 * Agent-accessible equivalent of the "Move task to inbox" command-palette action.
 * Routes a task into a specific project member's inbox by creating the same
 * TaskMovedToInbox notification the UI creates. See HTPR-4553.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    let body: MoveToInboxBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }

    const { task_id, ticket_number, unique_index, project_id, user_id } = body

    if (!user_id || !Number.isInteger(user_id) || user_id <= 0) {
      return NextResponse.json(
        { success: false, error: 'user_id (positive integer) is required — the member whose inbox receives the task.' },
        { status: 400 }
      )
    }

    const idCount = [!!task_id, !!ticket_number, !!unique_index].filter(Boolean).length
    if (idCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Either task_id, ticket_number, or (project_id + unique_index) must be provided' },
        { status: 400 }
      )
    }
    if (idCount > 1) {
      return NextResponse.json(
        { success: false, error: 'Cannot provide multiple task identification methods. Use one of: task_id, ticket_number, or (project_id + unique_index)' },
        { status: 400 }
      )
    }
    if (unique_index != null && !project_id) {
      return NextResponse.json(
        { success: false, error: 'project_id is required when using unique_index' },
        { status: 400 }
      )
    }

    // Caller must have access to the task; findTaskByIdentifier scopes by owner/member/agent.
    const task = await findTaskByIdentifier(
      ctx.user,
      {
        task_id: task_id ?? null,
        ticket_number: ticket_number ?? null,
        unique_index: unique_index ?? null,
        project_id: project_id ?? null,
      },
      ctx.agentId
    )
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    // The recipient must be a member of the task's project. Without this, any caller
    // could push a task (and its title/link) into an arbitrary internal user's inbox.
    const memberCheck = await validateProjectMemberIds(task.projectId, [user_id])
    if (memberCheck.error) {
      return NextResponse.json(
        { success: false, error: memberCheck.error.message },
        { status: memberCheck.error.status }
      )
    }
    if (memberCheck.invalidIds.length > 0) {
      return NextResponse.json(
        { success: false, error: `User ${user_id} is not a member of this project and cannot receive the task in their inbox.` },
        { status: 400 }
      )
    }

    // Mirror the palette payload exactly so the notification renders identically.
    const payload = {
      taskId: task.id,
      userId: user_id,
      projectId: task.projectId,
      type: 'TaskMovedToInbox',
      fromUserId: user_id,
    }
    await ensureTaskMovedToInbox(
      { userId: user_id, taskId: task.id, projectId: task.projectId },
      payload,
    )

    return NextResponse.json({
      success: true,
      message: 'Task moved to inbox',
      taskId: task.id,
      userId: user_id,
    })
  } catch (error) {
    console.error('[MCP] inbox/move', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
