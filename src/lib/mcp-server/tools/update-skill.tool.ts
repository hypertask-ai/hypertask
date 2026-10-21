import { getUpdateSkillBaseSchema } from '../validations/skill.validation';
import { SkillService } from '../lib/services/skill.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

export const updateSkillTool = {
  name: TOOL_METADATA.UPDATE_SKILL.name,
  description: TOOL_METADATA.UPDATE_SKILL.description,
  parameters: getUpdateSkillBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = args;
    return executeWithService(context, SkillService, 'updateSkill', validatedInput);
  },
};
