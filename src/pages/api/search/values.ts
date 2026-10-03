import type { NextApiHandler } from 'next'
import { getSessionUser } from '@/lib/auth/getSessionUser'
import { HTPR_6369_SEARCH_OPERATORS_FLAG, isFeatureEnabled } from '@/lib/flags'
import { HTPR_6370_SEARCH_CHIPS_FLAG, HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG, HTPR_6865_SEARCH_LAYOUT_FLAG, HTPR_6878_SEARCH_LABEL_SCOPE_FLAG } from '@/lib/flags'
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const session = await getSessionUser(new Headers(req.headers as Record<string, string>))
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (!await isFeatureEnabled(HTPR_6369_SEARCH_OPERATORS_FLAG, session.userId)) {
    return res.status(404).json({ error: 'Not found' })
  }
  const chipsEnabled = await isFeatureEnabled(HTPR_6370_SEARCH_CHIPS_FLAG, session.userId)
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
  const layoutEnabled = chipsEnabled &&
    await isFeatureEnabled(HTPR_6865_SEARCH_LAYOUT_FLAG, session.userId) &&
    await isFeatureEnabled(HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG, session.userId)
  const labelScopeEnabled = operator === 'label' && layoutEnabled &&
    await isFeatureEnabled(HTPR_6878_SEARCH_LABEL_SCOPE_FLAG, session.userId)
  const pickedBoardIds = labelScopeEnabled ? String(req.query.boards ?? '').split(',')
    .filter((id) => /^\d+$/.test(id)).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : []
  let candidates: { id: string | number; name: string; email?: string; count?: number; byName?: boolean; preferred: boolean; recent: number }[]
  let resolved: string | undefined
  let resolvedId: string | undefined
  const rawTail = chipsEnabled && typeof req.query.resolve === 'string' ? req.query.resolve.replace(/^[@#]/, '').trim().slice(0, 100) : ''
  const words = rawTail.split(/\s+/)
  const variants = words.map((_, i) => words.slice(0, i + 1).join(' ')).reverse().slice(0, 10)
  if (operator === 'in' || operator === 'board') {
    candidates = boards.map((board) => ({ id: board.id, name: board.title ?? '', preferred: board.id === activeBoardId, recent: 0 }))
    resolved = boards.filter((board) => variants.some((part) => part === String(board.id) || part.toLowerCase() === board.title?.toLowerCase())).map((board) => board.title ?? '')
      .sort((a, b) => b.length - a.length)[0]
  } else if (operator === 'label') {
    const scope = { projectId: { in: activeBoardId ? [activeBoardId] : ids } }
    if (chipsEnabled) scope.projectId.in = ids
    if (labelScopeEnabled) {
      scope.projectId.in = pickedBoardIds.length ? ids.filter((id) => pickedBoardIds.includes(id)) : ids
      // Read the whole label scope so duplicate names and used labels cannot fall behind a candidate cap.
      const labels = await prisma.label.findMany({
        where: scope, select: { id: true, value: true, projectId: true },
        orderBy: [{ value: 'asc' }, { id: 'asc' }],
      })
      const counts = await prisma.taskLabel.groupBy({
        by: ['labelId'],
        where: { labelId: { in: labels.map((label) => label.id) }, task: { status: 'Normal', projectId: scope.projectId } },
        _count: { _all: true },
      })
      const countById = new Map(counts.map((row) => [row.labelId, row._count._all]))
      candidates = labels.map((label) => ({
        id: label.id, name: label.value ?? '', count: countById.get(label.id) ?? 0,
        preferred: label.projectId === activeBoardId, recent: 0,
      }))
      if (!pickedBoardIds.length) {
        const unique = new Map<string, typeof candidates[number]>()
        for (const candidate of candidates) {
          const name = candidate.name.trim()
          const key = name.toLowerCase()
          const previous = unique.get(key)
          if (previous) {
            previous.count! += candidate.count!
            previous.preferred ||= candidate.preferred
          } else unique.set(key, { ...candidate, name, byName: true })
        }
        candidates = [...unique.values()]
      }
      if (rawTail) {
        const exact = labels.filter((label) => variants.some((part) => part === label.id || part.toLowerCase() === label.value?.toLowerCase()))
        resolved = exact.map((label) => label.value ?? '').sort((a, b) => b.length - a.length)[0]
        resolvedId = exact.find((label) => label.value === resolved && variants.includes(label.id))?.id
      }
    } else {
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
      const seen = new Set([...prefix, ...contains].map((label) => label.id))
      const fuzzy = chipsEnabled && value.length >= 2 && seen.size < 10 ? await prisma.label.findMany({
        where: { ...scope, AND: [...new Set(value)].map((letter) => ({ value: { contains: letter, mode: 'insensitive' as const } })) },
        select: { id: true, value: true, projectId: true },
        orderBy: [{ value: 'asc' }, { id: 'asc' }], take: 500,
      }) : []
      candidates = [...prefix, ...contains].map((label) => ({ id: label.id, name: label.value ?? '', preferred: label.projectId === activeBoardId, recent: 0 }))
      candidates.push(...fuzzy.filter((label) => !seen.has(label.id)).map((label) => ({ id: label.id, name: label.value ?? '', preferred: label.projectId === activeBoardId, recent: 0 })))
      if (rawTail) {
        const exact = await prisma.label.findMany({
          where: { ...scope, OR: variants.flatMap((part) => [{ value: { equals: part, mode: 'insensitive' as const } }, { id: part }]) },
          select: { id: true, value: true }, take: variants.length,
        })
        resolved = exact.map((label) => label.value ?? '').sort((a, b) => b.length - a.length)[0]
        resolvedId = exact.find((label) => label.value === resolved && variants.includes(label.id))?.id
      }
    }
  } else {
    const scope = activeBoardId ? [activeBoardId] : ids
    if (chipsEnabled) scope.push(...ids.filter((id) => !scope.includes(id)))
    const recent = new Date(Date.now() - 90 * 86400000)
    const where = { OR: [
      ...(activeBoardId ? [{ members: { some: { projectId: activeBoardId } } }] : []),
      ...(chipsEnabled ? [{ members: { some: { projectId: { in: ids } } } }] : []),
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
    const recentIds = chipsEnabled ? [
      ...await prisma.task.findMany({ where: { projectId: { in: scope }, createdAt: { gte: recent } }, select: { userId: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ...await prisma.assignees.findMany({ where: { task: { projectId: { in: scope } }, assignedAt: { gte: recent } }, select: { userId: true }, orderBy: { assignedAt: 'desc' }, take: 100 }),
    ].map((row) => row.userId) : []
    const recentPeople = recentIds.length ? await prisma.user.findMany({
      where: { AND: [where, { id: { in: recentIds } }] }, select, take: 200,
    }) : []
    const prefix = await prisma.user.findMany({
      where: { AND: [where, nameFilter('startsWith')] },
      select, orderBy: [{ displayName: 'asc' }, { email: 'asc' }, { id: 'asc' }], take: 100,
    })
    const contains = prefix.length < 100 && value ? await prisma.user.findMany({
      where: { AND: [where, nameFilter('contains'), { NOT: nameFilter('startsWith') }] },
      select, orderBy: [{ displayName: 'asc' }, { email: 'asc' }, { id: 'asc' }], take: 100 - prefix.length,
    }) : []
    const seen = new Set([...prefix, ...contains].map((person) => person.id))
    const fuzzy = chipsEnabled && value.length >= 2 && seen.size < 10 ? await prisma.user.findMany({
      where: { AND: [where, ...[...new Set(value)].map((letter) => ({ OR: [
        { displayName: { contains: letter, mode: 'insensitive' as const } },
        { AND: [{ OR: [{ displayName: null }, { displayName: '' }] }, { email: { contains: letter, mode: 'insensitive' as const } }] },
      ] }))] }, select,
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }, { id: 'asc' }], take: 500,
    }) : []
    const people = [...prefix, ...contains]
    if (chipsEnabled) {
      const unique = new Map([...recentPeople, ...fuzzy, ...people].map((person) => [person.id, person]))
      people.splice(0, people.length, ...unique.values())
    }
    candidates = people.map((person) => ({
      id: person.id, name: person.displayName || person.email,
      ...(layoutEnabled ? { email: person.email } : {}),
      preferred: person.members.length > 0,
      recent: Math.max(person.tasks[0]?.createdAt.getTime() ?? 0, person.assignees[0]?.assignedAt.getTime() ?? 0),
    }))
    if (rawTail) {
      const exact = await prisma.user.findMany({
        where: { AND: [where, { OR: variants.flatMap((part) => [
          { displayName: { equals: part, mode: 'insensitive' as const } },
          { AND: [{ OR: [{ displayName: null }, { displayName: '' }] }, { email: { equals: part, mode: 'insensitive' as const } }] },
          ...( /^\d+$/.test(part) ? [{ id: Number(part) }] : []),
        ]) }] },
        select: { id: true, displayName: true, email: true }, orderBy: [{ displayName: 'desc' }, { email: 'desc' }], take: 100,
      })
      resolved = exact.map((person) => person.displayName || person.email)
        .sort((a, b) => b.length - a.length)[0]
    }
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
      (labelScopeEnabled ? Number(b.count! > 0) - Number(a.count! > 0) : 0) ||
      rank(a) - rank(b) || Number(b.preferred) - Number(a.preferred) || b.recent - a.recent || a.name.localeCompare(b.name)
    )
    .slice(0, 10).map(({ id, name, email, count, byName }) => ({ id, name, ...(email !== undefined ? { email } : {}), ...(count !== undefined ? { count } : {}), ...(byName ? { byName } : {}) }))
  if (resolved) return res.status(200).json({ candidates: ranked, resolved, ...(resolvedId ? { resolvedId } : {}) })
  return res.status(200).json({ candidates: ranked })
}

export default handler
