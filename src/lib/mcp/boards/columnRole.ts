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

const LEGACY_ROLE_KEYWORDS: Array<{
  role: Exclude<BoardColumnRole, 'other' | 'blocked' | 'qa' | 'release'>
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

const WORKFLOW_ROLE_KEYWORDS: Array<{
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
  const present = new Set(titles.map((title) => columnRole(title, true)))
  return (['blocked', 'qa', 'release'] as const)
    .filter((place) => !present.has(place))
    .map((place) => WORKFLOW_COLUMN_TITLES[place])
}

export function columnRole(title: string, workflowColumns = false): BoardColumnRole {
  const normalizedTitle = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
  const keywords = workflowColumns ? WORKFLOW_ROLE_KEYWORDS : LEGACY_ROLE_KEYWORDS

  for (const { role, keywords: roleKeywords } of keywords) {
    if (roleKeywords.some((keyword) => normalizedTitle.includes(` ${keyword} `))) {
      return role
    }
  }

  return 'other'
}

export function columnRoleFor(section: {
  section_title: string
  isDone?: boolean | null
}, workflowColumns = false): BoardColumnRole {
  if (section.isDone === true) return 'done'
  const nameBasedRole = columnRole(section.section_title, workflowColumns)
  return section.isDone === false && nameBasedRole === 'done'
    ? 'other'
    : nameBasedRole
}
