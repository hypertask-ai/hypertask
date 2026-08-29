import { validateAndSanitizeGetSkillInput, getGetSkillBaseSchema } from '../validations/skill.validation';
import { SkillService } from '../lib/services/skill.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: get_skill
 * Gets one personal or project skill by ID.
 */
export const getSkillTool = {
  name: TOOL_METADATA.GET_SKILL.name,
  description: TOOL_METADATA.GET_SKILL.description,
  parameters: getGetSkillBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = validateAndSanitizeGetSkillInput(args);
    return executeWithService(context, SkillService, 'getSkill', validatedInput);
  },
};
