import { getListProjectsInputSchema } from '../validations/project.validation';
import { ProjectService } from '../lib/services/project.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: list_projects
 * Lists all accessible projects/boards with optional filtering.
 */
export const listProjectsTool = {
  name: TOOL_METADATA.LIST_PROJECTS.name,
  description: TOOL_METADATA.LIST_PROJECTS.description,
  parameters: getListProjectsInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(
      context,
      ProjectService,
      'listProjects',
      args
    );
  },
};
