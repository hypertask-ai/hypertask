import {
  validateAndSanitizeAddCommentCrudInput,
  getAddCommentCrudBaseSchema,
} from '../validations/comment.validation';
import { validateAndSanitizeAddCommentInput } from '../validations/comment.validation';
import { CommentService } from '../lib/services/comment.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

/**
 * Tool: add_comment
 * Add, update, or delete a comment. Use action: add (create), update (edit), delete (remove).
 * For update/delete, call get_comments_for_task first to obtain comment_id.
 */
const AddCommentCrudBaseSchema = getAddCommentCrudBaseSchema();

export const addCommentTool = {
  name: TOOL_METADATA.ADD_COMMENT.name,
  description: TOOL_METADATA.ADD_COMMENT.description,
  parameters: AddCommentCrudBaseSchema,
  execute: async (
    args: unknown,
    context: any,
    invocation?: { requestId: string; clientFingerprint: string }
  ) => {
    const rawArgs = args as Record<string, any>;
    const action = rawArgs?.action ?? 'add';

    // Only normalize task input when action is add (update/delete use comment_id only)
    const normalizedArgs =
      action === 'add' ? normalizeTaskInput(rawArgs) : rawArgs;

    const validatedInput = validateAndSanitizeAddCommentCrudInput(normalizedArgs);

    return executeWithService(
      context,
      CommentService,
      async (service) => {
        if (validatedInput.action === 'add') {
          const addParams = validateAndSanitizeAddCommentInput({
            task_id: validatedInput.task_id,
            ticket_number: validatedInput.ticket_number,
            project_id: validatedInput.project_id,
            unique_index: validatedInput.unique_index,
            text: validatedInput.text,
            content_type: validatedInput.content_type,
            mentions: validatedInput.mentions,
            attachments: validatedInput.attachments,
            reply_to_comment_id: validatedInput.reply_to_comment_id,
            reply_to_invocation_id: validatedInput.reply_to_invocation_id,
          });
          const result = await service.addComment(addParams, invocation);
          return result;
        }

        if (validatedInput.action === 'update') {
          const result = await service.updateComment({
            comment_id: validatedInput.comment_id!,
            text: validatedInput.text!,
            content_type: validatedInput.content_type,
            mentions: validatedInput.mentions,
          });
          return { success: true, comment: result.comment };
        }

        if (validatedInput.action === 'delete') {
          const result = await service.deleteComment({
            comment_id: validatedInput.comment_id!,
          });
          return { success: true, message: result.message };
        }

        throw new Error(`Unknown action: ${(validatedInput as any).action}`);
      },
      validatedInput
    );
  },
};
