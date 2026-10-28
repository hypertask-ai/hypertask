import prisma from '@/lib/prisma'
import { HTPR_7529_MCP_ACT_AS_AGENT_FLAG, isFeatureEnabled } from '@/lib/flags'
import { ActAsAgentError, actAsAgentContext, type ActAsAgentDatabase } from '@/lib/mcp/agents/actAs'
import { createInProcessMcpClient } from '@/lib/mcp/inProcessClient'
import { withMcpExecutionContext } from '@/lib/mcp/operationContext'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import { normalizeTaskInput } from './normalize-task-input'

type ActAsInput = Record<string, unknown>

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined

async function boardOfTask(userId: number, input: ActAsInput): Promise<number | undefined> {
  const task_id = positive(input.task_id)
  const ticket_number = typeof input.ticket_number === 'string' ? input.ticket_number : undefined
  const unique_index = positive(input.unique_index)
  const project_id = positive(input.project_id)
  if (!task_id && !ticket_number && !unique_index) return project_id
  const task = await findTaskByIdentifier({ id: userId }, { task_id, ticket_number, unique_index, project_id })
  if (!task) throw new ActAsAgentError('The ticket in input was not found on a board you can open.')
  return task.projectId
}

async function boardOfComment(userId: number, commentId: number): Promise<number> {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, task: { status: { not: 'Deleted' }, project: getProjectWhere(userId) } },
    select: { task: { select: { projectId: true } } },
  })
  if (!comment) throw new ActAsAgentError(`Comment ${commentId} was not found on a board you can open.`)
  return comment.task.projectId
}

async function boardOfDecision(userId: number, decisionId: number): Promise<number> {
  const decision = await prisma.decisionRequest.findFirst({
    where: { id: decisionId, task: { status: { not: 'Deleted' }, project: getProjectWhere(userId) } },
    select: { task: { select: { projectId: true } } },
  })
  if (!decision) throw new ActAsAgentError(`Decision request ${decisionId} was not found on a board you can open.`)
  return decision.task.projectId
}

export async function resolveActAsBoards(userId: number, raw: ActAsInput): Promise<number[]> {
  const input = normalizeTaskInput(raw)
  const boards = new Set<number>()
  const commentId = positive(input.comment_id)
  const decisionId = positive(input.decision_request_id)
  if (commentId) boards.add(await boardOfComment(userId, commentId))
  else if (decisionId) boards.add(await boardOfDecision(userId, decisionId))
  else {
    const board = await boardOfTask(userId, input)
    if (board) boards.add(board)
  }
  const target = positive(input.target_project_id)
  if (target) boards.add(target)
  return [...boards]
}

export async function runAsAgent<T>(
  token: string,
  request: { agentId: string; input: ActAsInput; write: boolean; requireBoard: boolean },
  run: () => Promise<T>,
): Promise<T> {
  const { auth } = await createInProcessMcpClient(token)
  if (!(await isFeatureEnabled(HTPR_7529_MCP_ACT_AS_AGENT_FLAG, auth.user.id))) {
    throw new ActAsAgentError('as_agent is not switched on for this account yet.')
  }
  const projectIds = request.requireBoard ? await resolveActAsBoards(auth.user.id, request.input) : []
  const agentAuth = await actAsAgentContext(prisma as unknown as ActAsAgentDatabase, auth, {
    agentId: request.agentId,
    projectIds,
    write: request.write,
    requireBoard: request.requireBoard,
  })
  return withMcpExecutionContext(token, agentAuth, run)
}
