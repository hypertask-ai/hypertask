import { validateAndSanitizeImportSkillsInput, getImportSkillsBaseSchema } from '../validations/skill.validation';
import { SkillService } from '../lib/services/skill.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: import_skills
 * Imports personal or project skills from GitHub.
 */
export const importSkillsTool = {
  name: TOOL_METADATA.IMPORT_SKILLS.name,
  description: TOOL_METADATA.IMPORT_SKILLS.description,
  parameters: getImportSkillsBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = validateAndSanitizeImportSkillsInput(args);
    return executeWithService(context, SkillService, 'importSkills', validatedInput);
  },
};
