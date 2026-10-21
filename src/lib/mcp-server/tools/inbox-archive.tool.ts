import { InboxService } from '../lib/services/inbox.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getInboxArchiveInputSchema } from '../validations/inbox.validation';

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
