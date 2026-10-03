import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { searchComments, searchTasks } from '@/utils/controllers/turbopuffer/turbopufferHelper'
import { commenterWhere, searchFilterWhere } from './filters'
import type { ParsedSearch } from './operators'

export async function rankedSearchWhere(
  parsed: ParsedSearch,
  projectIds: number[],
  status: 'Normal' | 'Archive' | null,
  limit = 50,
  extraWhere: Prisma.TaskWhereInput = {},
  cursorId?: number | null,
  scanAll = false,
  commenterEnabled = false,
  taskOrderBy?: Prisma.TaskOrderByWithRelationInput[],
) {
  const where = await searchFilterWhere(parsed, projectIds, status)
  const rankedIds: number[] = []
  const descriptionById = new Map<number, string>()
  const commentById = new Map<number, { id: string | number; commentText: string; creatorName: string; createdAt?: Date | string }>()
  const commenters = parsed.filters.commenter?.filter(({ negated }) => !negated) ?? []
  if (commenters.length) {
    const matching = commenterWhere(commenters, parsed.text)
    const taskWhere: Prisma.TaskWhereInput = { AND: [where, extraWhere] }
    let cursorValid = true
    let page: { taskId: number }[]
    if (taskOrderBy) {
      page = (await prisma.task.findMany({
        where: taskWhere, select: { id: true }, orderBy: taskOrderBy, take: limit,
        skip: cursorId ? 1 : 0, ...(cursorId ? { cursor: { id: cursorId } } : {}),
      })).map(({ id }) => ({ taskId: id }))
    } else {
      const anchor = cursorId ? await prisma.comment.findFirst({
        where: { ...matching, taskId: cursorId, task: taskWhere },
        select: { createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }) : null
      cursorValid = !cursorId || Boolean(anchor)
      const having = anchor && cursorId ? { OR: [
        { createdAt: { _max: { lt: anchor.createdAt } } },
        { createdAt: { _max: { equals: anchor.createdAt } }, taskId: { lt: cursorId } },
      ] } : undefined
      // Group and page in the database: Prisma's distinct would deduplicate in memory.
      const groups = cursorValid ? await prisma.comment.groupBy({
        by: ['taskId'], where: { ...matching, task: taskWhere },
        _max: { createdAt: true }, having,
        orderBy: [{ _max: { createdAt: 'desc' } }, { taskId: 'desc' }], take: limit,
      }) : []
      page = groups
    }
    const comments = await Promise.all(page.map(({ taskId }) => prisma.comment.findFirst({
      where: { ...matching, taskId, task: taskWhere },
      select: { id: true, taskId: true, commentText: true, createdAt: true, creator: { select: { displayName: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })))
    for (const comment of comments) {
      if (!comment) continue
      rankedIds.push(comment.taskId)
      commentById.set(comment.taskId, { ...comment, creatorName: comment.creator?.displayName || comment.creator?.email || '' })
    }
    return { where, rankedIds, descriptionById, commentById, partial: false, paged: true, cursorValid }
  }
  if (!parsed.text) return { where, rankedIds, descriptionById, commentById, partial: false }

  const maxWindow = 800
  const maxCandidates = 1600
  const maxIterations = 4
  const seen = new Set<number>()
  let window = 100
  let iterations = 0
  let exhausted = false
  while (iterations < maxIterations && seen.size < maxCandidates && (scanAll || (cursorId != null
    ? rankedIds.indexOf(cursorId) < 0 || rankedIds.length - rankedIds.indexOf(cursorId) - 1 < limit
    : rankedIds.length < limit))) {
    iterations++
    const [tasks, comments] = await Promise.all([
      searchTasks({ searchQuery: parsed.text, projectIds, status: parsed.filters.is ? undefined : status, topK: window, keywordOnly: true }),
      searchComments({ searchQuery: parsed.text, projectIds, status: parsed.filters.is ? undefined : status, topK: window, limit: window, keywordOnly: true, groupByTask: false }),
    ])
    const candidates = [...tasks.map((row) => ({ id: Number(row.id), description: row.descriptionText, comment: undefined })),
      ...comments.map((row) => ({ id: Number(row.taskId), description: '', comment: row }))]
    let truncated = false
    const fresh = candidates.filter(({ id, description, comment }) => {
      if (!Number.isInteger(id) || seen.has(id)) return false
      if (seen.size >= maxCandidates) {
        truncated = true
        return false
      }
      seen.add(id)
      if (description) descriptionById.set(id, description)
      if (comment) commentById.set(id, commenterEnabled
        ? { id: comment.id, commentText: comment.commentText, creatorName: comment.creatorName, createdAt: comment.createdAt ? new Date(comment.createdAt) : undefined }
        : comment)
      return true
    })
    if (fresh.length) {
      const matches = await prisma.task.findMany({
        where: { AND: [where, extraWhere], id: { in: fresh.map(({ id }) => id) } },
        select: { id: true },
      })
      const matching = new Set(matches.map((row) => row.id))
      rankedIds.push(...fresh.map(({ id }) => id).filter((id) => matching.has(id)))
    }
    if (tasks.length < window && comments.length < window && !truncated) {
      exhausted = true
      break
    }
    window = Math.min(window * 2, maxWindow)
  }
  return { where, rankedIds, descriptionById, commentById, partial: !exhausted }
}
