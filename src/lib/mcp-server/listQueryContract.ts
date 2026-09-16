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
import { withListQueryDescription } from './listQueryDescriptions'

export {
  LIST_QUERY_DESCRIPTION_SUFFIX,
  LIST_TASKS_LEGACY_DESCRIPTION,
  withListQueryDescription,
} from './listQueryDescriptions'

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
      description: withListQueryDescription(tool.name, tool.description, listQueryEnabled),
    }
  })
}
