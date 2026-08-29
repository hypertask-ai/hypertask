import { validateAndSanitizeListSkillsInput, getListSkillsBaseSchema } from '../validations/skill.validation';
import { SkillService } from '../lib/services/skill.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: list_skills
 * Lists personal skills by default, or project skills when project_id is provided.
 */
export const listSkillsTool = {
  name: TOOL_METADATA.LIST_SKILLS.name,
  description: TOOL_METADATA.LIST_SKILLS.description,
  parameters: getListSkillsBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = validateAndSanitizeListSkillsInput(args);
    return executeWithService(context, SkillService, 'listSkills', validatedInput);
  },
};
