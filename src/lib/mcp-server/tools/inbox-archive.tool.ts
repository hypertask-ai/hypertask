import { InboxService } from '../lib/services/inbox.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getInboxArchiveInputSchema } from '../validations/inbox.validation';

/**
 * Tool: inbox_archive
 * Archives one or multiple notifications from the user's inbox by notification_ids.
 */
export const inboxArchiveTool = {
  name: TOOL_METADATA.INBOX_ARCHIVE.name,
  description: TOOL_METADATA.INBOX_ARCHIVE.description,
  parameters: getInboxArchiveInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(
      context,
      InboxService,
      'archiveInbox',
      args
    );
  },
};
