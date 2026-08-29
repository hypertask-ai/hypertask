import { CommentService } from '../lib/services/comment.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import {
  getUpdateCommentBaseSchema,
  UpdateCommentInputSchema,
} from '../validations/comment.validation';

/**
 * Tool: update_comment
 * Updates one of the authenticated user's comments.
 */
export const updateCommentTool = {
  name: TOOL_METADATA.UPDATE_COMMENT.name,
  description: TOOL_METADATA.UPDATE_COMMENT.description,
  parameters: getUpdateCommentBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = UpdateCommentInputSchema.parse(args);
    return executeWithService(
      context,
      CommentService,
      'updateComment',
      validatedInput
    );
  },
};
