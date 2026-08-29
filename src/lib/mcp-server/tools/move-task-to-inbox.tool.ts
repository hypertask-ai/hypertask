import { InboxService } from '../lib/services/inbox.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import {
  getMoveTaskToInboxBaseSchema,
  MoveTaskToInboxInputSchema,
} from '../validations/inbox.validation';

/**
 * Tool: move_task_to_inbox
 * Routes a task into a project member's inbox, mirroring the command-palette action.
 */
export const moveTaskToInboxTool = {
  name: TOOL_METADATA.MOVE_TASK_TO_INBOX.name,
  description: TOOL_METADATA.MOVE_TASK_TO_INBOX.description,
  parameters: getMoveTaskToInboxBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = MoveTaskToInboxInputSchema.parse(args);
    return executeWithService(
      context,
      InboxService,
      'moveTaskToInbox',
      validatedInput
    );
  },
};
