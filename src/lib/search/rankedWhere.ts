import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { searchComments, searchTasks } from '@/utils/controllers/turbopuffer/turbopufferHelper'
import { searchFilterWhere } from './filters'
import type { ParsedSearch } from './operators'

export async function rankedSearchWhere(
  parsed: ParsedSearch,
  projectIds: number[],
  status: 'Normal' | 'Archive' | null,
  limit = 50,
  extraWhere: Prisma.TaskWhereInput = {},
  cursorId?: number | null,
  scanAll = false,
) {
  const where = await searchFilterWhere(parsed, projectIds, status)
  const rankedIds: number[] = []
  const descriptionById = new Map<number, string>()
  const commentById = new Map<number, { id: string; commentText: string; creatorName: string }>()
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
      if (comment) commentById.set(id, comment)
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
