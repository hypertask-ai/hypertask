import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { isQuestionComment, toLines } from '@/lib/inboxDecisions'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8200_BLOCKER_LIST_FLAG } from '@/lib/flags/definitions/htpr-8200-blocker-list'
import { HTPR_8917_AGENT_WAITING_PERSON_FLAG } from '@/lib/flags/definitions/htpr-8917-agent-waiting-person'
import type { McpAuthContext } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { getProjectListingWhere } from '@/utils/controllers/projects/getAllIncludes'

const AGENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function positiveId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null
}

export async function getBlockers(request: NextRequest, ctx: McpAuthContext) {
  if (ctx.management) return NextResponse.json({ success: false, error: 'Management tokens cannot list blockers.' }, { status: 403 })
  if (!await isFeatureEnabled(HTPR_8200_BLOCKER_LIST_FLAG, ctx.user.id)) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }

  const params = request.nextUrl.searchParams
  const users = params.getAll('waiting_on')
  const states = params.getAll('state')
  const rawProjects = [...params.getAll('projectId'), ...params.getAll('project')]
  const projects = rawProjects.map(positiveId)
  const mine = users.length === 0 || users[0] === 'me'
  const agentUuid = !mine && users.length === 1 && AGENT_UUID.test(users[0]) ? users[0] : null
  const agentFlag = await isFeatureEnabled(HTPR_8917_AGENT_WAITING_PERSON_FLAG, ctx.user.id)
  const agentList = Boolean(ctx.agentId) && agentFlag
  if (agentUuid && !agentFlag) {
    return NextResponse.json({ success: false, error: 'Invalid waiting_on, projectId, project, or state.' }, { status: 400 })
  }
  const target = mine ? ctx.user.id : agentUuid ? null : positiveId(users[0])
  if (users.length > 1 || (target === null && !agentUuid) || states.length > 1 ||
      (states.length && !['waiting', 'answered', 'no-question'].includes(states[0])) ||
      projects.some((id) => id === null)) {
    return NextResponse.json({ success: false, error: 'Invalid waiting_on, projectId, project, or state.' }, { status: 400 })
  }
  const personId = target ?? ctx.user.id
  const answerAgentId = agentUuid ?? (mine && agentList ? ctx.agentId : null)
  const projectIds = projects.filter((id): id is number => id !== null)
  const tasks = await prisma.task.findMany({
    where: {
      status: 'Normal',
      ...(agentUuid
        ? { waitingOnAgentId: agentUuid }
        : mine && agentList && ctx.agentId
          ? { OR: [{ waitingOnUserId: target }, { waitingOnAgentId: ctx.agentId }] }
          : { waitingOnUserId: target }),
      project: getProjectListingWhere(ctx.user.id, ctx.agentId, ctx.teamScope),
      ...(projectIds.length ? { projectId: { in: projectIds } } : {}),
    },
    select: {
      id: true, uniqueIndex: true, ticketNumber: true, title: true, section: true,
      projectId: true, waitingOnSetAt: true, blockerCommentId: true, waitingOnAgentId: true,
      project: { select: { title: true, name: true } },
      priority: { select: { Priority_Value: true } },
      blockerComment: { select: { id: true, taskId: true, text: true, commentText: true, activity: true, createdAt: true,
        reactions: {
          where: answerAgentId
            ? { isDeleted: false, OR: [{ userId: personId, agentId: null, agentDisplayName: null }, { agentId: answerAgentId }] }
            : { userId: personId, agentId: null, agentDisplayName: null, isDeleted: false },
          select: { createdAt: true, agentId: true },
        },
      } },
      comments: {
        where: answerAgentId
          ? { activity: { equals: Prisma.DbNull }, OR: [{ creatorId: personId, agentId: null, agentDisplayName: null }, { agentId: answerAgentId }] }
          : { creatorId: personId, agentId: null, agentDisplayName: null, activity: { equals: Prisma.DbNull } },
        select: { createdAt: true, agentId: true },
      },
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
    const onAgent = Boolean(answerAgentId) && task.waitingOnAgentId === answerAgentId
    const replies = task.comments.filter((comment) => !answerAgentId || (onAgent ? comment.agentId === answerAgentId : comment.agentId == null))
    const reactions = marked ? marked.reactions.filter((reaction) => !answerAgentId || (onAgent ? reaction.agentId === answerAgentId : reaction.agentId == null)) : []
    const answered = marked !== null && questionAt !== null && (replies.some((comment) => comment.createdAt > questionAt) ||
      reactions.some((reaction) => reaction.createdAt > questionAt))
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
}
