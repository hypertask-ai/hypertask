import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { isQuestionComment, toLines } from '@/lib/inboxDecisions'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8200_BLOCKER_LIST_FLAG } from '@/lib/flags/definitions/htpr-8200-blocker-list'
import { createUnauthorizedResponse } from '@/lib/mcp/auth'
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, validateMcpRouteAuth, checkMcpRouteRateLimit } from '@/lib/mcp/routeWrapper'
import prisma from '@/lib/prisma'
import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'

function positiveId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null
}

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
    try {
      const limited = await checkMcpRouteRateLimit(request)
      if (limited) return limited
      const ctx = await validateMcpRouteAuth(request)
      if (!ctx) return createUnauthorizedResponse('Invalid or missing authentication token.', 'invalid_token')
      if (ctx.management) return NextResponse.json({ success: false, error: 'Management tokens cannot list blockers.' }, { status: 403 })
      if (!await isFeatureEnabled(HTPR_8200_BLOCKER_LIST_FLAG, ctx.user.id)) {
        return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
      }

      const params = request.nextUrl.searchParams
      const users = params.getAll('waiting_on')
      const states = params.getAll('state')
      const rawProjects = [...params.getAll('projectId'), ...params.getAll('project')]
      const projects = rawProjects.map(positiveId)
      const target = users.length === 0 || users[0] === 'me' ? ctx.user.id : positiveId(users[0])
      if (users.length > 1 || target === null || states.length > 1 ||
          (states.length && !['waiting', 'answered', 'no-question'].includes(states[0])) ||
          projects.some((id) => id === null)) {
        return NextResponse.json({ success: false, error: 'Invalid waiting_on, projectId, project, or state.' }, { status: 400 })
      }
      const projectIds = projects.filter((id): id is number => id !== null)
      const tasks = await prisma.task.findMany({
        where: {
          status: 'Normal', waitingOnUserId: target,
          project: getProjectListingWhere(ctx.user.id, ctx.agentId, ctx.teamScope),
          ...(projectIds.length ? { projectId: { in: projectIds } } : {}),
        },
        select: {
          id: true, uniqueIndex: true, ticketNumber: true, title: true, section: true,
          projectId: true, waitingOnSetAt: true, blockerCommentId: true,
          project: { select: { title: true, name: true } },
          priority: { select: { Priority_Value: true } },
          blockerComment: { select: { id: true, taskId: true, text: true, commentText: true, activity: true, createdAt: true,
            reactions: { where: { userId: target, agentId: null, agentDisplayName: null, isDeleted: false }, select: { createdAt: true } },
          } },
          comments: { where: { creatorId: target, agentId: null, agentDisplayName: null, activity: { equals: Prisma.DbNull } }, select: { createdAt: true } },
        },
        orderBy: { id: 'asc' },
      })
      const blockers = tasks.map((task) => {
        const marked = task.blockerComment
        const valid = marked && marked.taskId === task.id && marked.activity === null &&
          (isQuestionComment(marked.text) || isQuestionComment(marked.commentText))
        const lines = valid ? toLines(isQuestionComment(marked.text) ? marked.text : marked.commentText) : []
        const questionIndex = lines.findIndex((line) => /^question:/i.test(line))
        const recommendationIndex = lines.findIndex((line) => /^(my )?recommendation:/i.test(line))
        const value = (index: number) => index < 0 ? null :
          (lines[index].replace(/^[^:]+:\s*/, '').trim() || (lines[index + 1] && !/^(question|(?:my )?recommendation|why|yes|no):/i.test(lines[index + 1]) ? lines[index + 1] : null))
        const questionAt = valid ? marked.createdAt : null
        const answered = marked !== null && questionAt !== null && (task.comments.some((comment) => comment.createdAt > questionAt) ||
          marked.reactions.some((reaction) => reaction.createdAt > questionAt))
        const state = !valid ? 'no-question' : answered ? 'answered' : 'waiting'
        return {
          id: task.id, ticketNumber: task.ticketNumber,
          url: `https://app.hypertask.ai/detail/project-${task.projectId}/${task.uniqueIndex}`,
          title: task.title, projectId: task.projectId, boardTitle: task.project.title ?? task.project.name,
          section: task.section, priority: task.priority?.Priority_Value ?? null,
          waitingSince: task.waitingOnSetAt, blockerCommentId: task.blockerCommentId,
          question: value(questionIndex), recommendation: value(recommendationIndex), state,
        }
      }).filter((row) => !states.length || row.state === states[0])
      return NextResponse.json({ success: true, blockers, total: blockers.length })
    } catch (error) {
      reportMcpOperationCrash(request, error)
      return NextResponse.json({ success: false, error: 'Failed to load blockers.' }, { status: 500 })
    }
  })(request)
}
