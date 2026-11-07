export type BoardColumnRole =
  | 'intake'
  | 'backlog'
  | 'ready'
  | 'in-progress'
  | 'blocked'
  | 'ai-review'
  | 'qa'
  | 'release'
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
  { role: 'blocked', keywords: ['blocked'] },
  { role: 'ai-review', keywords: ['ai review'] },
  { role: 'qa', keywords: ['qa'] },
  { role: 'release', keywords: ['release review', 'release verification', 'release'] },
  { role: 'human-review', keywords: ['valentin review', 'review'] },
  { role: 'done', keywords: ['done', 'complete', 'shipped'] },
]

const WORKFLOW_COLUMN_TITLES = {
  blocked: 'Blocked',
  qa: 'QA',
  release: 'Release',
} as const

export function missingWorkflowColumns(titles: readonly string[]): string[] {
  const present = new Set(titles.map((title) => columnRole(title)))
  return (['blocked', 'qa', 'release'] as const)
    .filter((place) => !present.has(place))
    .map((place) => WORKFLOW_COLUMN_TITLES[place])
}

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
