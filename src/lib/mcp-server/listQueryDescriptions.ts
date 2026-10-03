import { buildToolName } from './config/mcp-standards'

export const LIST_QUERY_DESCRIPTION_SUFFIX =
  ' Shared list params: query, filter (section, label, assignee, status, updated_since, has_pr), sort, fields, limit, and cursor. Same names on every list tool. filter.has_pr=red matches a red PR badge (failing checks or a closed PR). Example: fields=title,url.'

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
): string {
  if (
    LIST_QUERY_DESCRIPTION_TOOLS.has(name) &&
    !description.includes('Shared list params')
  ) {
    return `${description}${LIST_QUERY_DESCRIPTION_SUFFIX}`
  }
  return description
}
