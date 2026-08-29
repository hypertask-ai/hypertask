import { getCreateBoardInputSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { BoardService } from '../lib/services/board.service';

const CreateBoardSchema = getCreateBoardInputSchema();

/**
 * Tool: create_board (HTPR-3142)
 * Creates a board with columns, labels, and optional starter tasks from a structured manifest.
 * The agent infers title, sections[], labels[], tasks[] from the user (large specs → many tasks; see TOOL_METADATA); this tool persists in one call.
 */
export const createBoardTool = {
  name: TOOL_METADATA.CREATE_BOARD.name,
  description: TOOL_METADATA.CREATE_BOARD.description,
  parameters: CreateBoardSchema,
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, BoardService, 'createBoard', args);
  },
};
