import { CommentService } from '../lib/services/comment.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import {
  getDeleteCommentBaseSchema,
  DeleteCommentInputSchema,
} from '../validations/comment.validation';

/**
 * Tool: delete_comment
 * Deletes one of the authenticated user's comments.
 */
export const deleteCommentTool = {
  name: TOOL_METADATA.DELETE_COMMENT.name,
  description: TOOL_METADATA.DELETE_COMMENT.description,
  parameters: getDeleteCommentBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = DeleteCommentInputSchema.parse(args);
    return executeWithService(
      context,
      CommentService,
      'deleteComment',
      validatedInput
    );
  },
};
