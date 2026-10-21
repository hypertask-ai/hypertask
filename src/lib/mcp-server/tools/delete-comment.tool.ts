import { CommentService } from '../lib/services/comment.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getDeleteCommentBaseSchema } from '../validations/comment.validation';

export const deleteCommentTool = {
  name: TOOL_METADATA.DELETE_COMMENT.name,
  description: TOOL_METADATA.DELETE_COMMENT.description,
  parameters: getDeleteCommentBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = args;
    return executeWithService(
      context,
      CommentService,
      'deleteComment',
      validatedInput
    );
  },
};
