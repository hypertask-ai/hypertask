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
) {
  const where = await searchFilterWhere(parsed, projectIds, status)
  const rankedIds: number[] = []
  const descriptionById = new Map<number, string>()
  if (!parsed.text) return { where, rankedIds, descriptionById }

  const seen = new Set<number>()
  let window = 100
  while (cursorId != null
    ? rankedIds.indexOf(cursorId) < 0 || rankedIds.length - rankedIds.indexOf(cursorId) - 1 < limit
    : rankedIds.length < limit) {
    const [tasks, comments] = await Promise.all([
      searchTasks({ searchQuery: parsed.text, projectIds, status: parsed.filters.is ? undefined : status, topK: window, keywordOnly: true }),
      searchComments({ searchQuery: parsed.text, projectIds, status: parsed.filters.is ? undefined : status, topK: window, limit: window, keywordOnly: true, groupByTask: false }),
    ])
    const candidates = [...tasks.map((row) => ({ id: Number(row.id), description: row.descriptionText })),
      ...comments.map((row) => ({ id: Number(row.taskId), description: '' }))]
    const fresh = candidates.filter(({ id, description }) => {
      if (!Number.isInteger(id) || seen.has(id)) return false
      seen.add(id)
      if (description) descriptionById.set(id, description)
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
    if (tasks.length < window && comments.length < window) break
    window *= 2
  }
  return { where, rankedIds, descriptionById }
}
