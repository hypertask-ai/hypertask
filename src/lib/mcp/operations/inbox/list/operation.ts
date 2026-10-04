import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, createUnauthorizedResponse, checkMcpRateLimit } from '@/lib/mcp/auth'
import { getMcpSessionAgentSummary } from '@/lib/mcp/agents'
import notificationGetAll from '@/utils/controllers/notifications/getAll'
import { getStructuredInboxForAgent } from '@/utils/controllers/notifications/getStructuredInboxForAgent'
import prisma from '@/lib/prisma'
import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'
import { generalConfig } from '@/lib/configs/general.config'

function positiveInteger(value: string | null): number | null {
    if (value === null || !/^\d+$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * GET /api/mcp/inbox/list
 *
 * Returns inbox data that mirrors the app inbox view.
 *
 * Without agent JWT (flat):
 * { success, structuredData, notifications }
 *
 * With agent JWT (separate user + agent inboxes):
 * {
 *   success,
 *   agent: { id, displayName, photoURL? },
 *   user: { structuredData, notifications },
 *   agentInbox: { structuredData, notifications }
 * }
 */
export async function GET(request: NextRequest) {
    let userObj: {id: number, email: string} | null = null
    try {
        const rateLimited = await checkMcpRateLimit(request)
        if (rateLimited) return rateLimited
        const ctx = await validateMcpAuth(request)

        if (!ctx) {
            return createUnauthorizedResponse(
                'Invalid or missing authentication token.',
                'invalid_token'
            )
        }
        const user = ctx.user;
        userObj = user

        if (request.nextUrl.searchParams.get('agent_invocations') === 'true') {
            if (!ctx.agentId) {
                return NextResponse.json(
                    { success: false, error: 'agent_invocations requires an agent token' },
                    { status: 403 }
                )
            }
            const projectId = positiveInteger(request.nextUrl.searchParams.get('project_id'))
            const taskId = positiveInteger(request.nextUrl.searchParams.get('task_id'))
            if (projectId === null || taskId === null) {
                return NextResponse.json(
                    { success: false, error: 'project_id and task_id must be positive integers' },
                    { status: 400 }
                )
            }

            const agentInvocations = await prisma.notification.findMany({
                where: {
                    agentId: ctx.agentId,
                    projectId,
                    taskId,
                    type: 'Mentioned',
                    status: 'Normal',
                    agentReplyConsumedAt: null,
                    fromAgentId: null,
                    fromUserId: { not: generalConfig.hyperAiId },
                    task: {
                        status: 'Normal',
                        project: getProjectListingWhere(user.id, ctx.agentId),
                    },
                },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 100,
                select: {
                    id: true,
                    taskId: true,
                    projectId: true,
                    commentId: true,
                    fromUserId: true,
                    createdAt: true,
                },
            })

            return NextResponse.json({
                success: true,
                agent_invocations: agentInvocations.map((invocation) => ({
                    id: invocation.id,
                    task_id: invocation.taskId,
                    project_id: invocation.projectId,
                    comment_id: invocation.commentId,
                    from_user_id: invocation.fromUserId,
                    created_at: invocation.createdAt.toISOString(),
                })),
            })
        }

        if (ctx.agentId) {
            const [userInboxResult, agentInbox] = await Promise.all([
                notificationGetAll(user.id.toString()),
                getStructuredInboxForAgent({
                    userId: user.id,
                    agentId: ctx.agentId,
                }),
            ])

            if (!agentInbox.ok) {
                if (agentInbox.kind === 'not_found') {
                    return NextResponse.json(
                        { success: false, error: 'Agent does not exist' },
                        { status: 404 }
                    )
                }
                console.error('[MCP] inbox/list', {
                    user: { id: user.id, email: user.email },
                    agentId: ctx.agentId,
                    note: 'getStructuredInboxForAgent failed',
                })
                return NextResponse.json(
                    { success: false, error: 'Failed to load inbox' },
                    { status: 500 }
                )
            }

            const { status, json } = userInboxResult
            if (status !== 200 || !json || !('structuredData' in json)) {
                console.error('[MCP] inbox/list', {
                    user: { id: user.id, email: user.email },
                    agentId: ctx.agentId,
                    status,
                    hasJson: !!json,
                    note: 'notificationGetAll failed while loading user inbox',
                })
                return NextResponse.json(
                    { success: false, error: 'Failed to load inbox' },
                    { status: 500 }
                )
            }

            return NextResponse.json({
                success: true,
                user_structured_data: json.structuredData,
                user_notifications: json.notifications,
                agent_structured_data: agentInbox.structuredData,
                agent_notifications: agentInbox.notifications,
                user_splits_no_important: 'splitsNoImportant' in json ? json.splitsNoImportant : [],
                user_show_important_split: 'showImportantSplit' in json ? json.showImportantSplit : false,
            })
        }

        const { status, json } = await notificationGetAll(user.id.toString())

        if (status !== 200 || !json || !('structuredData' in json)) {
            console.error('[MCP] inbox/list', {
                user: { id: user.id, email: user.email },
                status,
                hasJson: !!json,
                hasStructuredData: json != null && typeof json === 'object' && 'structuredData' in json,
                note: 'notificationGetAll failed or response missing structuredData',
            })
            return NextResponse.json(
                { success: false, error: 'Failed to load inbox' },
                { status: 500 }
            )
        }

        const { structuredData, notifications } = json

        return NextResponse.json({
            success: true,
            structuredData,
            user_notifications: notifications,
            splitsNoImportant: 'splitsNoImportant' in json ? json.splitsNoImportant : [],
            showImportantSplit: 'showImportantSplit' in json ? json.showImportantSplit : false,
        })
    } catch (error) {
        console.error('[MCP] inbox/list', {
            user: userObj,
            error,
            message: error instanceof Error ? error.message : String(error),
        })
        return NextResponse.json(
            {
                success: false,
                error: 'Internal server error',
            },
            { status: 500 }
        )
    }
}
