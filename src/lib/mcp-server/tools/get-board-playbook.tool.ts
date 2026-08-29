import { getBoardPlaybookInputSchema } from '../validations/project.validation';
import { ProjectService } from '../lib/services/project.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: get_board_playbook
 * Gets a board's working rules and definition of done.
 */
export const getBoardPlaybookTool = {
  name: TOOL_METADATA.GET_BOARD_PLAYBOOK.name,
  description: TOOL_METADATA.GET_BOARD_PLAYBOOK.description,
  parameters: getBoardPlaybookInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(
      context,
      ProjectService,
      'getBoardPlaybook',
      args
    );
  },
};
