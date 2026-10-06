import { EstimateConstants, PriorityConstants } from '@/lib/constants/constants'
import prisma from '@/lib/prisma'
import { NextResponse } from 'next/server'
import { signSession, SESSION_COOKIE } from '@/lib/auth/session'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { requireRole } from '@/lib/mcp/agents/scopes'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import { hasActiveTaskOnlyMutation, isActiveTaskMutationTarget } from './activeTaskMutation'
import { linkTaskPullRequest } from '@/lib/pullRequests/taskPullRequests'
import { validateTaskUpdateFields } from './fields/validateFields'
import { validateTaskUpdateIdentifiers } from './fields/validateIdentifiers'
import { findTasksByIdentifier } from './fields/findTasks'
import { persistTaskUpdates } from './fields/persist'
import { UpdateTaskPersistenceError, type ExecuteTaskUpdateOptions, type TaskUpdateExecutionResult } from './fields/types'

async function validate(options: ExecuteTaskUpdateOptions) {
  const { ctx, requestBody, dryRun = false } = options
  if (ctx.agentId) {
    const denied = await requireRole(ctx, 'write')
    if (denied) return denied
  }
  const fields = await validateTaskUpdateFields(requestBody, dryRun, ctx.user)
  if (fields instanceof NextResponse) return fields
  const identifiers = validateTaskUpdateIdentifiers(requestBody, dryRun, fields)
  if (identifiers instanceof NextResponse) return identifiers
  return { fields, identifiers }
}

type UpdatePlan = Exclude<Awaited<ReturnType<typeof validate>>, NextResponse>

async function preflight(options: ExecuteTaskUpdateOptions, plan: UpdatePlan) {
  const { ctx, requestBody, dryRun = false } = options
  const tasks = await findTasksByIdentifier(ctx.user, plan.identifiers, ctx.agentId)
  const would = { task_ids: tasks.map((task) => task.id), request: plan.identifiers.normalizedRequestBody }
  if (!tasks.length) {
    return {
      response: dryRun
        ? NextResponse.json({ success: true, dry_run: true, valid: true, would }, { status: 200 })
        : NextResponse.json({ success: false, tasks: [], error: 'Task not found or access denied' }, { status: 404 }),
      outcome: 'not_found' as const,
    }
  }
  if (hasActiveTaskOnlyMutation(requestBody)) {
    if (tasks.some((task) => task.status === 'Archive')) {
      return { response: NextResponse.json({ success: false, error: 'Archived tasks cannot move sections or change assignees. Unarchive them first.' }, { status: 409 }), outcome: 'error' as const }
    }
    if (tasks.some((task) => !isActiveTaskMutationTarget(task.status))) {
      return { response: NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 }), outcome: 'not_found' as const }
    }
  }

  // Observe speculative section failures only after the user and cookie checks,
  // preserving V1's error precedence while independent reads overlap.
  const [userResult, sectionResult] = await Promise.allSettled([
    prisma.user.findUnique({ where: { id: ctx.user.id }, select: { id: true, email: true, displayName: true, photoURL: true } }),
    requestBody.sectionId
      ? prisma.section.findUnique({ where: { id: requestBody.sectionId }, select: { section_title: true, projectId: true } })
      : Promise.resolve(undefined),
  ])
  if (userResult.status === 'rejected') throw userResult.reason
  const userObj = userResult.value
  if (!userObj) {
    return { response: NextResponse.json({ ...buildFieldError('not_found', 'user_id', 'User not found'), ...(dryRun && { valid: false }) }, { status: 404 }), outcome: 'error' as const }
  }
  const userCookie = JSON.stringify(slimUserForCookie({
    id: userObj.id, email: userObj.email, displayName: userObj.displayName, photoURL: userObj.photoURL ?? undefined,
  }))
  const sessionToken = signSession({ id: userObj.id, email: userObj.email, ...(ctx.agentId ? { agentId: ctx.agentId } : {}) })
  if (sectionResult.status === 'rejected') throw sectionResult.reason
  const sectionInfo = sectionResult.value ?? undefined
  if (dryRun) {
    return { response: NextResponse.json({ success: true, dry_run: true, valid: true, would }, { status: 200 }), outcome: 'success' as const }
  }
  return {
    tasks,
    context: {
      ...plan.fields,
      request: options.request, ctx, user: ctx.user, requestBody, userObj,
      baseUrl: process.env.NEXT_PUBLIC_BASEURL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
      authCookieHeader: `nookies_user=${encodeURIComponent(userCookie)}; ${SESSION_COOKIE}=${sessionToken}`,
      sectionInfo,
      priorityConstant: plan.identifiers.priorityIndex !== undefined ? PriorityConstants.find((value) => value.priority_index === plan.identifiers.priorityIndex) : null,
      estimateConstant: requestBody.estimate !== undefined ? EstimateConstants.find((value) => value.estimate_index === requestBody.estimate) : null,
      assignAssignees: options.assignAssignees, clearAssignees: options.clearAssignees,
      linkPullRequest: options.linkPullRequest ?? linkTaskPullRequest,
      strictSideEffectFailures: options.strictSideEffectFailures ?? false,
    },
  }
}

function receipt(response: NextResponse): TaskUpdateExecutionResult {
  return { response, outcome: response.status >= 400 ? 'error' : 'success' }
}

export async function executeTaskUpdateV2(options: ExecuteTaskUpdateOptions): Promise<TaskUpdateExecutionResult> {
  const plan = await validate(options)
  if (plan instanceof NextResponse) return receipt(plan)
  const ready = await preflight(options, plan)
  if ('response' in ready) return ready as TaskUpdateExecutionResult
  const persist = () => persistTaskUpdates(ready.context, ready.tasks)
  try {
    const result = options.persist ? await options.persist(persist) : await persist()
    return receipt(NextResponse.json(result, { status: 200 }))
  } catch (error) {
    if (error instanceof UpdateTaskPersistenceError) return receipt(NextResponse.json(error.response, { status: error.status }))
    throw error
  }
}
