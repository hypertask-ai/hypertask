import { validateAndSanitizeCreateSkillInput, getCreateSkillBaseSchema } from '../validations/skill.validation';
import { SkillService } from '../lib/services/skill.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: create_skill
 * Creates a personal or project skill from SKILL.md content or structured fields.
 */
export const createSkillTool = {
  name: TOOL_METADATA.CREATE_SKILL.name,
  description: TOOL_METADATA.CREATE_SKILL.description,
  parameters: getCreateSkillBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = validateAndSanitizeCreateSkillInput(args);
    return executeWithService(context, SkillService, 'createSkill', validatedInput);
  },
};
