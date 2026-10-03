import { RenameBoardInputSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { BoardService } from '../lib/services/board.service';

export const renameBoardTool = {
  name: TOOL_METADATA.RENAME_BOARD.name,
  description: TOOL_METADATA.RENAME_BOARD.description,
  parameters: RenameBoardInputSchema,
  execute: async (args: unknown, context: unknown) => {
    const input = RenameBoardInputSchema.parse(args);
    return executeWithService(context, BoardService, 'renameBoard', input);
  },
};
