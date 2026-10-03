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
  withListQueryDescription,
} from './listQueryDescriptions'

const LIST_QUERY_PARAMETER_FACTORIES: Record<
  string,
  () => PortableTool['parameters']
> = {
  [TOOL_METADATA.LIST_TASKS.name]: () => getListTasksInputSchema(),
  [TOOL_METADATA.SEARCH_TASKS.name]: () =>
    getEnhancedSearchTasksInputSchema(),
  [TOOL_METADATA.LIST_PROJECTS.name]: () => getListProjectsInputSchema(),
  [TOOL_METADATA.LIST_LABELS.name]: () => getListLabelsBaseSchema(),
  [TOOL_METADATA.SECTION_CRUD.name]: () => getSectionCrudBaseSchema(),
  [TOOL_METADATA.GET_COMMENTS.name]: () => getGetCommentsBaseSchema(),
  [TOOL_METADATA.LIST_AGENTS.name]: () => getListAgentsInputSchema(),
}

export function resolvePortableTools(
  tools: readonly PortableTool[],
): PortableTool[] {
  return tools.map((tool) => {
    const parametersFactory = LIST_QUERY_PARAMETER_FACTORIES[tool.name]
    return {
      ...tool,
      parameters: parametersFactory ? parametersFactory() : tool.parameters,
      description: withListQueryDescription(tool.name, tool.description),
    }
  })
}
