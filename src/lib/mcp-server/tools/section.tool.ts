import { getSectionCrudBaseSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { SectionService } from '../lib/services/section.service';

export const sectionTool = {
  name: TOOL_METADATA.SECTION_CRUD.name,
  description: TOOL_METADATA.SECTION_CRUD.description,
  parameters: getSectionCrudBaseSchema(),
  execute: async (args: unknown, context: unknown) => {
    const validatedInput = args;
    return executeWithService(context, SectionService, 'manageSection', validatedInput);
  },
};
