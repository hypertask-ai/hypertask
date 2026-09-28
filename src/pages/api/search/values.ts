import type { NextApiHandler } from 'next'
import { getSessionUser } from '@/lib/auth/getSessionUser'
import { HTPR_6369_SEARCH_OPERATORS_FLAG, isFeatureEnabled } from '@/lib/flags'
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const session = await getSessionUser(new Headers(req.headers as Record<string, string>))
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (!await isFeatureEnabled(HTPR_6369_SEARCH_OPERATORS_FLAG, session.userId)) {
    return res.status(404).json({ error: 'Not found' })
  }
  const operator = String(req.query.operator ?? '').toLowerCase()
  const value = String(req.query.value ?? '').replace(/^@/, '').trim().toLowerCase().slice(0, 100)
  const boardId = Number(req.query.boardId)
  if (!['from', 'assignee', 'in', 'board', 'label'].includes(operator)) {
    return res.status(400).json({ error: 'Unknown operator' })
  }
  const boards = await prisma.project.findMany({
    where: { status: 'Normal', ...getProjectWhere(session.userId) },
    select: { id: true, title: true },
  })
  const ids = boards.map((board) => board.id)
  if (!ids.length) return res.status(200).json({ candidates: [] })
  const activeBoardId = ids.includes(boardId) ? boardId : null
  let candidates: { id: string | number; name: string; preferred: boolean; recent: number }[]
  if (operator === 'in' || operator === 'board') {
    candidates = boards.map((board) => ({ id: board.id, name: board.title ?? '', preferred: board.id === activeBoardId, recent: 0 }))
  } else if (operator === 'label') {
    const scope = { projectId: { in: activeBoardId ? [activeBoardId] : ids } }
    const prefix = await prisma.label.findMany({
      where: { ...scope, value: { startsWith: value, mode: 'insensitive' } },
      select: { id: true, value: true, projectId: true },
      orderBy: [{ value: 'asc' }, { id: 'asc' }],
      take: 100,
    })
    const contains = prefix.length < 100 && value ? await prisma.label.findMany({
      where: { ...scope, AND: [
        { value: { contains: value, mode: 'insensitive' } },
        { NOT: { value: { startsWith: value, mode: 'insensitive' } } },
      ] },
      select: { id: true, value: true, projectId: true },
      orderBy: [{ value: 'asc' }, { id: 'asc' }],
      take: 100 - prefix.length,
    }) : []
    candidates = [...prefix, ...contains].map((label) => ({ id: label.id, name: label.value ?? '', preferred: label.projectId === activeBoardId, recent: 0 }))
  } else {
    const scope = activeBoardId ? [activeBoardId] : ids
    const recent = new Date(Date.now() - 90 * 86400000)
    const where = { OR: [
      ...(activeBoardId ? [{ members: { some: { projectId: activeBoardId } } }] : []),
      { tasks: { some: { projectId: { in: scope }, ...(!activeBoardId ? { createdAt: { gte: recent } } : {}) } } },
      { assignees: { some: { task: { projectId: { in: scope } }, ...(!activeBoardId ? { assignedAt: { gte: recent } } : {}) } } },
    ] }
    const select = {
      id: true, displayName: true, email: true,
      members: { where: { projectId: activeBoardId ?? { in: ids } }, select: { projectId: true }, take: 1 },
      tasks: { where: { projectId: { in: ids } }, select: { createdAt: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
      assignees: { where: { task: { projectId: { in: ids } } }, select: { assignedAt: true }, orderBy: { assignedAt: 'desc' as const }, take: 1 },
    } as const
    const nameFilter = (kind: 'startsWith' | 'contains') => ({ OR: [
      { displayName: { [kind]: value, mode: 'insensitive' as const } },
      { AND: [
        { OR: [{ displayName: null }, { displayName: '' }] },
        { email: { [kind]: value, mode: 'insensitive' as const } },
      ] },
    ] })
    const prefix = await prisma.user.findMany({
      where: { AND: [where, nameFilter('startsWith')] },
      select, orderBy: [{ displayName: 'asc' }, { email: 'asc' }, { id: 'asc' }], take: 100,
    })
    const contains = prefix.length < 100 && value ? await prisma.user.findMany({
      where: { AND: [where, nameFilter('contains'), { NOT: nameFilter('startsWith') }] },
      select, orderBy: [{ displayName: 'asc' }, { email: 'asc' }, { id: 'asc' }], take: 100 - prefix.length,
    }) : []
    const people = [...prefix, ...contains]
    candidates = people.map((person) => ({
      id: person.id, name: person.displayName || person.email,
      preferred: person.members.length > 0,
      recent: Math.max(person.tasks[0]?.createdAt.getTime() ?? 0, person.assignees[0]?.assignedAt.getTime() ?? 0),
    }))
  }
  const rank = (item: typeof candidates[number]) => {
    const name = item.name.toLowerCase()
    if (name.startsWith(value) || String(item.id).startsWith(value)) return 0
    if (name.includes(value)) return 1
    let cursor = 0
    for (const letter of name) if (letter === value[cursor]) cursor++
    return cursor === value.length ? 2 : 3
  }
  const ranked = candidates.filter((item) => rank(item) < 3)
    .sort((a, b) =>
      rank(a) - rank(b) || Number(b.preferred) - Number(a.preferred) || b.recent - a.recent || a.name.localeCompare(b.name)
    )
    .slice(0, 10).map(({ id, name }) => ({ id, name }))
  return res.status(200).json({ candidates: ranked })
}

export default handler
