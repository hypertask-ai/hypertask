import { TOOL_METADATA } from '../config/tool-metadata';
import { ProjectService } from '../lib/services/project.service';
import { executeWithService } from '../utils/executeWithService';
import {
  BoardConfigInputSchema,
  getBoardConfigBaseSchema,
} from '../validations/project.validation';

export const boardConfigTool = {
  name: TOOL_METADATA.BOARD_CONFIG.name,
  description: TOOL_METADATA.BOARD_CONFIG.description,
  parameters: getBoardConfigBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = BoardConfigInputSchema.parse(args);
    return executeWithService(
      context,
      ProjectService,
      'manageBoardConfig',
      validatedInput
    );
  },
};
