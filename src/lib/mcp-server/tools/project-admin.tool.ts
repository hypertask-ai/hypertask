import { TOOL_METADATA } from '../config/tool-metadata';
import { ProjectService } from '../lib/services/project.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getProjectAdminBaseSchema,
  ProjectAdminInputSchema,
} from '../validations/project.validation';

export const projectAdminTool = {
  name: TOOL_METADATA.PROJECT_ADMIN.name,
  description: TOOL_METADATA.PROJECT_ADMIN.description,
  parameters: getProjectAdminBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = ProjectAdminInputSchema.parse(args);
    return executeWithService(
      context,
      ProjectService,
      'manageProjectAdmin',
      validatedInput
    );
  },
};
