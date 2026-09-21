import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { validateMcpAuth, createUnauthorizedResponse, checkMcpRateLimit } from '@/lib/mcp/auth'
import { inboxConfig, agentSplitName, staleSplitName } from '@/lib/configs/inbox.config'
import { generalConfig } from '@/lib/configs/general.config'
import {
    evaluateInboxZero,
    inboxZeroDoneNameFallback,
    loadActiveInboxZeroNotifications,
    loadDoneTitlesByProject,
} from '@/utils/controllers/notifications/inboxZero'
import { DEFAULT_INBOX_ZERO_RULES } from '@/lib/inboxZero'
import { isDoneColumn } from '@/lib/doneColumns'

/**
 * GET /api/mcp/inbox/composition?project_id=<id>
 *
 * Shows the SHAPE of a board's inbox noise so Important can be tuned against real
 * traffic: per recipient, how many active notifications they hold, of which type,
 * from whom, and which split each lands in.
 *
 * Counts only. No task titles, no comment text, no notification rows.
 */

const SPLIT_BY_TYPE: Record<string, string> = {
    TaskMoved: 'Updates',
    TaskArchived: 'Updates',
    TaskDueDate: 'Updates',
    Reacted: 'Reactions',
    Comment: 'Important',
    Assigned: 'Important',
    TaskReminder: 'Important',
    TaskMovedToInbox: 'Important',
    TaskUpdateDescription: 'Important',
    TaskOverdue: 'Important',
    AddedToFollowerInTask: '@Mentions',
    Mentioned: '@Mentions',
}

type ActorKind = 'human' | 'agent' | 'self'

export async function GET(request: NextRequest) {
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

        const projectId = parseInt(
            request.nextUrl.searchParams.get('project_id') ?? '',
            10
        )
        if (!Number.isFinite(projectId)) {
            return NextResponse.json(
                { success: false, error: 'project_id is required' },
                { status: 400 }
            )
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true, title: true, name: true, ownerId: true, stalenessEnabled: true },
        })
        if (!project) {
            return NextResponse.json(
                { success: false, error: 'Project not found' },
                { status: 404 }
            )
        }

        // Team-internal stat: you have to be on the board to see its shape.
        if (project.ownerId !== ctx.user.id) {
            const membership = await prisma.member.findFirst({
                where: { projectId, userId: ctx.user.id, agentId: null },
                select: { id: true },
            })
            if (!membership) {
                return NextResponse.json(
                    { success: false, error: 'You are not a member of this project' },
                    { status: 403 }
                )
            }
        }

        const rows = await prisma.notification.groupBy({
            by: ['userId', 'type', 'fromAgentId', 'fromUserId', 'taskId'],
            where: {
                projectId,
                status: 'Normal',
                agentId: null,
                task: { status: 'Normal' },
            },
            _count: { _all: true },
        })

        // HTPR-4769: task state feeds the liveness + addressed-to-you gates, so the
        // report mirrors what the inbox actually shows.
        const taskIds = Array.from(
            new Set(rows.map((row) => row.taskId).filter((id): id is number => id != null))
        )
        const tasks = taskIds.length
            ? await prisma.task.findMany({
                  where: { id: { in: taskIds } },
                  select: {
                      id: true,
                      status: true,
                      section: true,
                      updatedAt: true,
                      createdAt: true,
                      sectionChangedAt: true,
                      comments: {
                          where: { agentId: null, creatorId: { not: null } },
                          orderBy: { createdAt: 'desc' as const },
                          take: 1,
                          select: { createdAt: true },
                      },
                      assignees: { select: { userId: true, agentId: true } },
                  },
              })
            : []
        const taskById = new Map(tasks.map((task) => [task.id, task]))
        const staleCutoff = Date.now() - inboxConfig.staleDays * 24 * 60 * 60 * 1000
        const userIds = Array.from(new Set(rows.map((row) => row.userId)))
        const activeByUser = new Map<
            number,
            Awaited<ReturnType<typeof loadActiveInboxZeroNotifications>>
        >()
        const doneProjectIds = new Set(rows.length ? [projectId] : [])
        for (const userId of userIds) {
            const active = await loadActiveInboxZeroNotifications(userId)
            activeByUser.set(userId, active)
            for (const notification of active) {
                if (notification.task) doneProjectIds.add(notification.task.projectId)
            }
        }
        const doneTitlesByProject = await loadDoneTitlesByProject(
            doneProjectIds,
            inboxZeroDoneNameFallback
        )
        const projectDoneTitles = doneTitlesByProject.get(projectId)

        type Bucket = {
            userId: number
            total: number
            byType: Record<string, number>
            byActor: Record<ActorKind, number>
            bySplit: Record<string, number>
            importantLegacy: number
            importantByType: Record<string, number>
            importantByActorKey: Record<string, number>
        }
        const byUser = new Map<number, Bucket>()

        for (const row of rows) {
            const count = row._count._all
            let bucket = byUser.get(row.userId)
            if (!bucket) {
                bucket = {
                    userId: row.userId,
                    total: 0,
                    byType: {},
                    byActor: { human: 0, agent: 0, self: 0 },
                    bySplit: {},
                    importantLegacy: 0,
                    importantByType: {},
                    importantByActorKey: {},
                }
                byUser.set(row.userId, bucket)
            }

            const importantActorKey = row.fromAgentId != null
                ? `a:${row.fromAgentId}`
                : row.fromUserId != null
                  ? `u:${row.fromUserId}`
                  : 'system'

            // HyperAI posts under its own user account rather than an Agent record.
            const isAgent =
                !!row.fromAgentId || row.fromUserId === generalConfig.hyperAiId
            const isSelf = !row.fromAgentId && row.fromUserId === row.userId
            const actor: ActorKind = isSelf ? 'self' : isAgent ? 'agent' : 'human'

            const isAgentChore =
                isAgent && (inboxConfig.agentSplitTypes as string[]).includes(row.type)
            let split = isAgentChore
                ? agentSplitName
                : SPLIT_BY_TYPE[row.type] ?? 'Other'

            // Same gates as getInboxTabs: Important = names you, on a live task.
            const task = row.taskId != null ? taskById.get(row.taskId) : undefined
            // Human-activity clock, matching getInboxTabs: bot property bumps
            // (updatedAt) must not keep a task alive.
            const lastHumanActivity = task
                ? Math.max(
                      ...[task.comments[0]?.createdAt, task.sectionChangedAt, task.createdAt]
                          .filter((time): time is Date => !!time)
                          .map((time) => time.getTime()),
                      0
                  ) || (task.updatedAt?.getTime() ?? Date.now())
                : Date.now()
            const isStale =
                !!task && task.status !== 'Archive' && lastHumanActivity <= staleCutoff
            const alive =
                !task ||
                (task.status !== 'Archive' &&
                    !isDoneColumn(
                        task.section,
                        projectDoneTitles,
                        inboxZeroDoneNameFallback
                    ) &&
                    !isStale)
            // Stale rows get their own shelf only on boards that opted in.
            const demotedHome =
                isStale && project.stalenessEnabled ? staleSplitName : 'Updates'
            const addressed =
                (inboxConfig.importantAddressedAlways as string[]).includes(row.type) ||
                ((inboxConfig.importantAddressedIfAssigned as string[]).includes(row.type) &&
                    (!task ||
                        task.assignees.some(
                            (assignee) => assignee.userId === row.userId && assignee.agentId == null
                        )))
            if (split === 'Important') {
                bucket.importantLegacy += count
                if (!alive || !addressed) split = demotedHome
                else {
                    bucket.importantByType[row.type] =
                        (bucket.importantByType[row.type] ?? 0) + count
                    bucket.importantByActorKey[importantActorKey] =
                        (bucket.importantByActorKey[importantActorKey] ?? 0) + count
                }
            } else if (split === 'Updates') {
                split = demotedHome
            }

            bucket.total += count
            bucket.byType[row.type] = (bucket.byType[row.type] ?? 0) + count
            bucket.byActor[actor] += count
            bucket.bySplit[split] = (bucket.bySplit[split] ?? 0) + count
            if (row.type === 'Mentioned') {
                bucket.importantLegacy += count
                // Known approximation: the inbox lets a mention newer than the Done
                // move survive; the groupBy carries no timestamps, so this report
                // counts every mention on a Done task as demoted. Counts-only tool,
                // the divergence is rare and conservative.
                if (alive) {
                    bucket.bySplit.Important = (bucket.bySplit.Important ?? 0) + count
                    bucket.importantByType.Mentioned =
                        (bucket.importantByType.Mentioned ?? 0) + count
                    bucket.importantByActorKey[importantActorKey] =
                        (bucket.importantByActorKey[importantActorKey] ?? 0) + count
                }
            }
        }

        const importantAgentIds = new Set<string>()
        const importantUserIds = new Set<number>()
        for (const bucket of byUser.values()) {
            for (const key of Object.keys(bucket.importantByActorKey)) {
                if (key.startsWith('a:')) importantAgentIds.add(key.slice(2))
                if (key.startsWith('u:')) importantUserIds.add(Number(key.slice(2)))
            }
        }

        // What the default Inbox Zero run would archive for each recipient, computed
        // with the real evaluator so the numbers match the button in the UI. This is
        // across their whole inbox (the evaluator is per user, not per board).
        const inboxZeroByUser = new Map<
            number,
            { wouldArchive: number; wouldKeep: number; totalActive: number }
        >()
        for (const userId of byUser.keys()) {
            const active = activeByUser.get(userId) ?? []
            const preview = evaluateInboxZero(
                active,
                userId,
                DEFAULT_INBOX_ZERO_RULES,
                new Date(),
                doneTitlesByProject
            )
            inboxZeroByUser.set(userId, {
                wouldArchive: preview.totalToArchive,
                wouldKeep: preview.totalLeft,
                totalActive: preview.totalActive,
            })
        }

        const agents = await prisma.agent.findMany({
            where: { id: { in: Array.from(importantAgentIds) } },
            select: { id: true, displayName: true },
        })
        const agentNameById = new Map(agents.map((agent) => [agent.id, agent.displayName]))

        const users = await prisma.user.findMany({
            where: {
                id: { in: Array.from(new Set([...byUser.keys(), ...importantUserIds])) },
            },
            select: { id: true, displayName: true },
        })
        const nameById = new Map(users.map((user) => [user.id, user.displayName]))

        return NextResponse.json({
            success: true,
            project: { id: project.id, title: project.title ?? project.name },
            users: Array.from(byUser.values())
                .map((bucket) => {
                    const { importantByActorKey, ...publicBucket } = bucket
                    const importantByActorCounts = new Map<string, number>()
                    for (const [key, count] of Object.entries(importantByActorKey)) {
                        const name = key.startsWith('a:')
                            ? agentNameById.get(key.slice(2)) ?? `Agent ${key.slice(2)}`
                            : key.startsWith('u:')
                              ? nameById.get(Number(key.slice(2))) ?? `User ${key.slice(2)}`
                              : 'system'
                        importantByActorCounts.set(
                            name,
                            (importantByActorCounts.get(name) ?? 0) + count
                        )
                    }
                    const importantByActor = Object.fromEntries(
                        Array.from(importantByActorCounts.entries()).sort(
                            ([leftName, leftCount], [rightName, rightCount]) =>
                                rightCount - leftCount || leftName.localeCompare(rightName)
                        )
                    )

                    return {
                        ...publicBucket,
                        importantByActor,
                        displayName: nameById.get(bucket.userId) ?? `User ${bucket.userId}`,
                        inboxZeroDefault: inboxZeroByUser.get(bucket.userId) ?? null,
                    }
                })
                .sort((left, right) => right.total - left.total),
        })
    } catch (error) {
        console.error('[MCP] inbox/composition', error)
        return NextResponse.json(
            { success: false, error: 'Failed to load inbox composition' },
            { status: 500 }
        )
    }
}
