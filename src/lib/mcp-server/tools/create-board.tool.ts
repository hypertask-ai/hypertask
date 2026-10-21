import { getCreateBoardInputSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { BoardService } from '../lib/services/board.service';

const CreateBoardSchema = getCreateBoardInputSchema();

export const createBoardTool = {
  name: TOOL_METADATA.CREATE_BOARD.name,
  description: TOOL_METADATA.CREATE_BOARD.description,
  parameters: CreateBoardSchema,
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, BoardService, 'createBoard', args);
  },
};
