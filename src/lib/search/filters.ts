import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { isDoneByName } from '@/lib/doneColumns'
import type { ParsedSearch, SearchFilter, SearchOperator } from './operators'

const exact = (value: string) => ({ equals: value, mode: 'insensitive' as const })
const identity = (value: string) => value.replace(/^@/, '').trim()
const numeric = (value: string) => /^\d+$/.test(value) ? Number(value) : null

function dateCondition(operator: 'before' | 'after' | 'on', raw: string): Prisma.TaskWhereInput | null {
  const match = raw.match(/^(?:(created|updated):)?(\d{4}-\d{2}-\d{2})$/i)
  if (!match) return null
  const day = new Date(`${match[2]}T00:00:00.000Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== match[2]) return null
  const next = new Date(day.getTime() + 86400000)
  const field = match[1]?.toLowerCase() === 'updated' ? 'updatedAt' : 'createdAt'
  return { [field]: operator === 'before'
    ? { lt: day }
    : operator === 'after'
      ? { gte: next }
      : { gte: day, lt: next } }
}

function filterWhere(operator: SearchOperator, value: string, done: Prisma.TaskWhereInput[]): Prisma.TaskWhereInput {
  const name = identity(value)
  const id = numeric(name)
  switch (operator) {
    case 'from': return id !== null ? { userId: id } : { user: { OR: [{ displayName: exact(name) }, { email: exact(name) }] } }
    case 'assignee': return { assignees: { some: id !== null ? { userId: id } : { user: { OR: [{ displayName: exact(name) }, { email: exact(name) }] } } } }
    case 'in':
    case 'board': {
      const board = name.replace(/^#/, '')
      const boardId = numeric(board)
      return boardId !== null ? { projectId: boardId } : { project: { title: exact(board) } }
    }
    case 'label': return { taskLabels: { some: { label: { OR: [{ id: name }, { value: exact(name) }] } } } }
    case 'is':
      switch (name.toLowerCase()) {
        case 'open': return done.length ? { status: 'Normal', NOT: { OR: done } } : { status: 'Normal' }
        case 'archived': return { status: 'Archive' }
        case 'done': return done.length ? { status: 'Normal', OR: done } : { id: -1 }
        default: return { id: -1 }
      }
    case 'has':
      switch (name.toLowerCase()) {
        case 'attachment': return { OR: [{ attachments: { some: {} } }, { comments: { some: { attachments: { some: {} } } } }] }
        case 'comment': return { comments: { some: {} } }
        case 'due':
        case 'due-date': return { dueDate: { not: null } }
        default: return { id: -1 }
      }
    case 'before':
    case 'after':
    case 'on': return dateCondition(operator, name) ?? { id: -1 }
  }
}

export async function searchFilterWhere(
  parsed: ParsedSearch,
  projectIds: number[],
  defaultStatus: 'Normal' | 'Archive' | null,
): Promise<Prisma.TaskWhereInput> {
  const doneSections = parsed.filters.is?.some(({ value }) => ['done', 'open'].includes(value.toLowerCase()))
    ? await prisma.section.findMany({
        where: { projectId: { in: projectIds }, deleted: false },
        select: { projectId: true, section_title: true, isDone: true },
      })
    : []
  const done: Prisma.TaskWhereInput[] = doneSections
    .filter((section) => section.isDone ?? isDoneByName(section.section_title))
    .map((section) => ({ projectId: section.projectId, section: section.section_title }))
  const groups: Prisma.TaskWhereInput[] = []
  for (const [key, values] of Object.entries(parsed.filters) as [SearchOperator, SearchFilter[]][]) {
    const included = values.filter(({ negated }) => !negated)
    if (included.length) groups.push({ OR: included.map(({ value }) => filterWhere(key, value, done)) })
    for (const { value } of values.filter(({ negated }) => negated)) {
      groups.push({ NOT: filterWhere(key, value, done) })
    }
  }
  return {
    projectId: { in: projectIds },
    ...(parsed.filters.is ? { status: { in: ['Normal', 'Archive'] } } : defaultStatus ? { status: defaultStatus } : { status: { in: ['Normal', 'Archive'] } }),
    AND: groups,
  }
}
