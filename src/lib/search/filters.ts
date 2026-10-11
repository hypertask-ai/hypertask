import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { isDoneByName } from '@/lib/doneColumns'
import type { ParsedSearch, SearchFilter, SearchFilterKey } from './operators'

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

// HTPR-6368: result kinds search returns are tickets (title or description) and comments.
export const SEARCH_RESULT_TYPES = { ticket: 'ticket', tickets: 'ticket', task: 'ticket', tasks: 'ticket', comment: 'comment', comments: 'comment' } as const
export const searchResultType = (value: string) => SEARCH_RESULT_TYPES[value.trim().toLowerCase() as keyof typeof SEARCH_RESULT_TYPES]
const PRIORITY_NAMES = ['urgent', 'high', 'medium', 'low']
const NO_MATCH: Prisma.TaskWhereInput = { id: -1 }

// type: only chooses which kind of hit is returned (tickets or comments); it never filters tickets by their comments.
export function resultKinds(parsed: ParsedSearch) {
  const kinds = (parsed.filters.type ?? []).map(({ value, negated }) => ({ kind: searchResultType(value), negated }))
  const only = kinds.filter(({ kind, negated }) => kind && !negated).map(({ kind }) => kind)
  const allowTasks = !kinds.some(({ kind, negated }) => kind === 'ticket' && negated) && (!only.length || only.includes('ticket'))
  const allowComments = !kinds.some(({ kind, negated }) => kind === 'comment' && negated) && (!only.length || only.includes('comment'))
  const commenterGiven = (parsed.filters.commenter ?? []).some(({ negated }) => !negated)
  // Where an exact phrase must appear: in the returned comment, in the ticket text, or anywhere on the ticket.
  const phraseScope = !allowComments ? 'ticket' as const : (!allowTasks || commenterGiven) ? 'comment' as const : 'any' as const
  return { allowTasks, allowComments, phraseScope, commentOnly: allowComments && !allowTasks, none: !allowTasks && !allowComments, invalid: kinds.some(({ kind, negated }) => !kind && !negated) }
}

function priorityWhere(name: string): Prisma.TaskWhereInput {
  const lower = name.trim().toLowerCase()
  if (['none', 'no', 'no priority', 'no-priority'].includes(lower)) {
    return { OR: [{ priority: { is: null } }, { priority: { is: { Priority_Value: exact('No Priority') } } }] }
  }
  return PRIORITY_NAMES.includes(lower) ? { priority: { is: { Priority_Value: exact(lower) } } } : NO_MATCH
}

function containsPhrase(phrase: string, scope: 'ticket' | 'any' | 'comment' = 'any'): Prisma.TaskWhereInput {
  const contains = { contains: phrase, mode: 'insensitive' as const }
  return { OR: [
    { title: contains },
    { description_: { is: { content: contains } } },
    ...(scope === 'any' ? [{ comments: { some: { activity: { equals: Prisma.DbNull }, OR: [{ commentText: contains }, { text: contains }] } } }] : []),
  ] }
}

// The phrase clauses a single comment must satisfy (positive: contains it, negated: does not).
export function commentPhraseWhere(phrases: SearchFilter[] = []): Prisma.CommentWhereInput[] {
  return phrases.map(({ value, negated }) => {
    const hit = { OR: [{ commentText: { contains: value, mode: 'insensitive' as const } }, { text: { contains: value, mode: 'insensitive' as const } }] }
    return negated ? { NOT: hit } : hit
  })
}

export function commentHasPhrases(commentText: string, phrases: SearchFilter[] = []) {
  const lower = commentText.toLowerCase()
  return phrases.every(({ value, negated }) => lower.includes(value.toLowerCase()) !== negated)
}

export function commenterWhere(filters: SearchFilter[], text = '', phrases: SearchFilter[] = []): Prisma.CommentWhereInput {
  const words = text.trim() ? text.trim().split(/\s+/).map((word) => ({ OR: [
    // API and CLI comments only fill the HTML text column.
    { commentText: { contains: word, mode: 'insensitive' as const } },
    { text: { contains: word, mode: 'insensitive' as const } },
  ] })) : []
  const and = [...words, ...commentPhraseWhere(phrases)]
  return {
    activity: { equals: Prisma.DbNull },
    ...(filters.length ? { OR: filters.map(({ value, userIds }) => {
      const name = identity(value)
      const id = numeric(name)
      if (id !== null) return { creatorId: id }
      if (userIds !== undefined) return { creatorId: { in: userIds } }
      return { creator: { OR: [{ displayName: exact(name) }, { email: exact(name) }] } }
    }) } : {}),
    ...(and.length ? { AND: and } : {}),
  }
}

function filterWhere(operator: SearchFilterKey, { value, userIds }: SearchFilter, done: Prisma.TaskWhereInput[], text = ''): Prisma.TaskWhereInput {
  const name = identity(value)
  const id = numeric(name)
  if (id === null && userIds !== undefined) {
    if (operator === 'from') return { userId: { in: userIds } }
    if (operator === 'assignee') return { assignees: { some: { userId: { in: userIds } } } }
  }
  switch (operator) {
    case 'commenter': return { comments: { some: commenterWhere([{ value, negated: false, userIds }], text) } }
    case 'from': return id !== null ? { userId: id } : { user: { OR: [{ displayName: exact(name) }, { email: exact(name) }] } }
    case 'assignee': return { assignees: { some: id !== null ? { userId: id } : { user: { OR: [{ displayName: exact(name) }, { email: exact(name) }] } } } }
    case 'in':
    case 'board': return id !== null ? { projectId: id } : { project: { title: exact(name) } }
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
        case 'comment': return { comments: { some: { activity: { equals: Prisma.DbNull } } } }
        case 'due':
        case 'due-date': return { dueDate: { not: null } }
        default: return { id: -1 }
      }
    case 'type': return NO_MATCH // never reached: searchFilterWhere handles type separately
    case 'priority': return priorityWhere(name)
    case 'phrase': return containsPhrase(name)
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
  const kinds = resultKinds(parsed)
  if (kinds.none || kinds.invalid) groups.push(NO_MATCH)
  for (const [key, values] of Object.entries(parsed.filters) as [SearchFilterKey, SearchFilter[]][]) {
    if (key === 'type') continue
    const included = values.filter(({ negated }) => !negated)
    if (key === 'phrase' && kinds.phraseScope === 'comment') continue // enforced on the comment itself
    if (key === 'phrase') groups.push(...included.map((filter) => containsPhrase(filter.value, kinds.phraseScope)))
    else if (included.length) groups.push({ OR: included.map((filter) => filterWhere(key, filter, done, parsed.text)) })
    for (const filter of values.filter(({ negated }) => negated)) {
      groups.push({ NOT: key === 'phrase' ? containsPhrase(filter.value, kinds.phraseScope) : filterWhere(key, filter, done) })
    }
  }
  return {
    projectId: { in: projectIds },
    ...(parsed.filters.is ? { status: { in: ['Normal', 'Archive'] } } : defaultStatus ? { status: defaultStatus } : { status: { in: ['Normal', 'Archive'] } }),
    AND: groups,
  }
}
