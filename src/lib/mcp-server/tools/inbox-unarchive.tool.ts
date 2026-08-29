import { InboxService } from '../lib/services/inbox.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getInboxUnarchiveInputSchema } from '../validations/inbox.validation';

/**
 * Tool: inbox_unarchive
 * Restores archived inbox notifications by notification_ids (same ids as inbox_list / archive).
 */
export const inboxUnarchiveTool = {
  name: TOOL_METADATA.INBOX_UNARCHIVE.name,
  description: TOOL_METADATA.INBOX_UNARCHIVE.description,
  parameters: getInboxUnarchiveInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, InboxService, 'unarchiveInbox', args);
  },
};
