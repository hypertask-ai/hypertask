import { getSectionCrudBaseSchema, SectionCrudInputSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { SectionService } from '../lib/services/section.service';

/**
 * Tool: section
 * Full CRUD for board columns/sections.
 *
 * Actions: list | get | create | update | delete
 */
export const sectionTool = {
  name: TOOL_METADATA.SECTION_CRUD.name,
  description: TOOL_METADATA.SECTION_CRUD.description,
  parameters: getSectionCrudBaseSchema(),
  execute: async (args: unknown, context: unknown) => {
    const validatedInput = SectionCrudInputSchema.parse(args);
    return executeWithService(context, SectionService, 'manageSection', validatedInput);
  },
};
