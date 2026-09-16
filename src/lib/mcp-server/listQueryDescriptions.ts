import { buildToolName } from './config/mcp-standards'

export const LIST_TASKS_LEGACY_DESCRIPTION =
  'Lists tasks with comprehensive filtering options. Filter by project, section (column title or section_id), assignee, priority, due date, status, labels, and more. Supports pagination and sorting. Results are automatically limited to boards/projects the user has access to. Prefer section_id (positive integer) when known; otherwise use section with the exact section_title from hypertask_section action=list. The CLI resolves section names to section_id per project. Each task includes a "link" field with the task URL: https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex} where uniqueIndex is extracted from the ticket number.'

export const LIST_QUERY_DESCRIPTION_SUFFIX =
  ' Shared list params: query, filter (section, label, assignee, status, updated_since, has_pr), sort, fields, limit, and cursor. Same names on every list tool. filter.has_pr=red matches a red PR badge (failing checks or a closed PR). Example: fields=title,url.'

const LIST_TASKS_NAME = buildToolName('list_tasks')

const LIST_QUERY_DESCRIPTION_TOOLS = new Set([
  buildToolName('search_tasks'),
  buildToolName('list_projects'),
  buildToolName('list_labels'),
  buildToolName('section'),
  buildToolName('get_comments_for_task'),
  buildToolName('list_agents'),
])

export function withListQueryDescription(
  name: string,
  description: string,
  listQueryEnabled: boolean,
): string {
  if (name === LIST_TASKS_NAME && !listQueryEnabled) {
    return LIST_TASKS_LEGACY_DESCRIPTION
  }
  if (
    listQueryEnabled &&
    LIST_QUERY_DESCRIPTION_TOOLS.has(name) &&
    !description.includes('Shared list params')
  ) {
    return `${description}${LIST_QUERY_DESCRIPTION_SUFFIX}`
  }
  return description
}
