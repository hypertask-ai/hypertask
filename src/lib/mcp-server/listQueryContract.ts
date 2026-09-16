import { TOOL_METADATA } from './config/tool-metadata'
import type { PortableTool } from './stateless-http'
import { getListAgentsInputSchema } from './validations/agent.validation'
import { getGetCommentsBaseSchema } from './validations/comment.validation'
import {
  getListLabelsBaseSchema,
  getListProjectsInputSchema,
  getSectionCrudBaseSchema,
} from './validations/project.validation'
import {
  getEnhancedSearchTasksInputSchema,
  getListTasksInputSchema,
} from './validations/task.validation'

export const LIST_TASKS_LEGACY_DESCRIPTION =
  'Lists tasks with comprehensive filtering options. Filter by project, section (column title or section_id), assignee, priority, due date, status, labels, and more. Supports pagination and sorting. Results are automatically limited to boards/projects the user has access to. Prefer section_id (positive integer) when known; otherwise use section with the exact section_title from hypertask_section action=list. The CLI resolves section names to section_id per project. Each task includes a "link" field with the task URL: https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex} where uniqueIndex is extracted from the ticket number.'

const LIST_QUERY_PARAMETER_FACTORIES: Record<
  string,
  (listQueryEnabled: boolean) => PortableTool['parameters']
> = {
  [TOOL_METADATA.LIST_TASKS.name]: (enabled) => getListTasksInputSchema({ listQuery: enabled }),
  [TOOL_METADATA.SEARCH_TASKS.name]: (enabled) =>
    getEnhancedSearchTasksInputSchema({ listQuery: enabled }),
  [TOOL_METADATA.LIST_PROJECTS.name]: (enabled) => getListProjectsInputSchema({ listQuery: enabled }),
  [TOOL_METADATA.LIST_LABELS.name]: (enabled) => getListLabelsBaseSchema({ listQuery: enabled }),
  [TOOL_METADATA.SECTION_CRUD.name]: (enabled) => getSectionCrudBaseSchema({ listQuery: enabled }),
  [TOOL_METADATA.GET_COMMENTS.name]: (enabled) => getGetCommentsBaseSchema({ listQuery: enabled }),
  [TOOL_METADATA.LIST_AGENTS.name]: (enabled) => getListAgentsInputSchema({ listQuery: enabled }),
}

export function resolvePortableTools(
  tools: readonly PortableTool[],
  listQueryEnabled: boolean,
): PortableTool[] {
  return tools.map((tool) => {
    const parametersFactory = LIST_QUERY_PARAMETER_FACTORIES[tool.name]
    return {
      ...tool,
      parameters: parametersFactory ? parametersFactory(listQueryEnabled) : tool.parameters,
      description:
        tool.name === TOOL_METADATA.LIST_TASKS.name && !listQueryEnabled
          ? LIST_TASKS_LEGACY_DESCRIPTION
          : tool.description,
    }
  })
}
