import { z } from 'zod';
import { ContextService } from '../lib/services/context.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: get_user_context
 * Gets the current user's context including boards/projects they have access to,
 * permissions, and user information.
 */
export const getUserContextTool = {
  name: TOOL_METADATA.GET_USER_CONTEXT.name,
  description: TOOL_METADATA.GET_USER_CONTEXT.description,
  parameters: z.object({}).strict(),
  execute: async (_args: unknown, context: any) => {
    return executeWithService(
      context,
      ContextService,
      async (service) => {
        return await service.getUserContext();
      },
      undefined
    );
  },
};
