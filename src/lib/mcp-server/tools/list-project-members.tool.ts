import { ListProjectMembersInputSchema } from '../validations/project.validation';
import { ProjectService } from '../lib/services/project.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

export const listProjectMembersTool = {
  name: TOOL_METADATA.LIST_PROJECT_MEMBERS.name,
  description: TOOL_METADATA.LIST_PROJECT_MEMBERS.description,
  parameters: ListProjectMembersInputSchema,
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, ProjectService, 'listProjectMembers', args);
  },
};
