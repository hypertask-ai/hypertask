import { InboxService } from '../lib/services/inbox.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import {
  getInboxListBaseSchema,
  InboxListInputSchema,
} from '../validations/inbox.validation';

/**
 * Tool: inbox_list
 * Lists inbox tasks for a user, categorized by notification type.
 */
export const inboxListTool = {
  name: TOOL_METADATA.INBOX_LIST.name,
  description: TOOL_METADATA.INBOX_LIST.description,
  parameters: getInboxListBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = InboxListInputSchema.parse(args);
    return executeWithService(
      context,
      InboxService,
      'listInbox',
      validatedInput
    );
  },
};
