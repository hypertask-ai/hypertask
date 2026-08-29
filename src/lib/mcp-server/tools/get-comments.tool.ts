import { getGetCommentsBaseSchema, GetCommentsInputSchema } from '../validations/comment.validation';
import { CommentService } from '../lib/services/comment.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

/**
 * Tool: get_comments
 * Gets comments for a specific task.
 */
export const getCommentsTool = {
  name: TOOL_METADATA.GET_COMMENTS.name,
  description: TOOL_METADATA.GET_COMMENTS.description,
  parameters: getGetCommentsBaseSchema(),
  execute: async (args: unknown, context: any) => {
    // Normalize input to handle URLs (extract project_id + unique_index from URLs)
    const normalizedArgs = normalizeTaskInput(args as Record<string, any>);
    
    // Validate with full schema (including refine)
    const validatedInput = GetCommentsInputSchema.parse(normalizedArgs);
    
    return executeWithService(
      context,
      CommentService,
      'getComments',
      validatedInput
    );
  },
};
