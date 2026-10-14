import { getDeleteSkillBaseSchema } from '../validations/skill.validation';
import { SkillService } from '../lib/services/skill.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

export const deleteSkillTool = {
  name: TOOL_METADATA.DELETE_SKILL.name,
  description: TOOL_METADATA.DELETE_SKILL.description,
  parameters: getDeleteSkillBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = args;
    return executeWithService(context, SkillService, 'deleteSkill', validatedInput);
  },
};
