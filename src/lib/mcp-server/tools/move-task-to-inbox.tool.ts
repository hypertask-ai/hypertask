import { InboxService } from '../lib/services/inbox.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getMoveTaskToInboxBaseSchema } from '../validations/inbox.validation';

export const moveTaskToInboxTool = {
  name: TOOL_METADATA.MOVE_TASK_TO_INBOX.name,
  description: TOOL_METADATA.MOVE_TASK_TO_INBOX.description,
  parameters: getMoveTaskToInboxBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = args;
    return executeWithService(
      context,
      InboxService,
      'moveTaskToInbox',
      validatedInput
    );
  },
};
