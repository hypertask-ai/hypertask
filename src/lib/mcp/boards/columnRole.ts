export type BoardColumnRole =
  | 'intake'
  | 'backlog'
  | 'ready'
  | 'in-progress'
  | 'ai-review'
  | 'human-review'
  | 'done'
  | 'other'

const ROLE_KEYWORDS: Array<{
  role: Exclude<BoardColumnRole, 'other'>
  keywords: string[]
}> = [
  { role: 'intake', keywords: ['triage', 'inbox', 'intake'] },
  { role: 'backlog', keywords: ['backlog'] },
  { role: 'ready', keywords: ['ready'] },
  { role: 'in-progress', keywords: ['in progress', 'doing', 'wip'] },
  { role: 'ai-review', keywords: ['ai review'] },
  { role: 'human-review', keywords: ['valentin review', 'review', 'qa'] },
  { role: 'done', keywords: ['done', 'complete', 'shipped'] },
]

export function columnRole(title: string): BoardColumnRole {
  const normalizedTitle = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `

  for (const { role, keywords } of ROLE_KEYWORDS) {
    if (keywords.some((keyword) => normalizedTitle.includes(` ${keyword} `))) {
      return role
    }
  }

  return 'other'
}

export function columnRoleFor(section: {
  section_title: string
  isDone?: boolean | null
}): BoardColumnRole {
  if (section.isDone === true) return 'done'
  const nameBasedRole = columnRole(section.section_title)
  return section.isDone === false && nameBasedRole === 'done'
    ? 'other'
    : nameBasedRole
}
