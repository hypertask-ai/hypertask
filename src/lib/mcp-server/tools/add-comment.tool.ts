import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7514_INLINE_AGENT_IMAGES_FLAG } from "@/lib/flags/keys";
import { getMcpExecutionContext } from "@/lib/mcp/operationContext";
import {
  validateAndSanitizeAddCommentCrudInput,
  getAddCommentCrudBaseSchema,
} from '../validations/comment.validation';
import { validateAndSanitizeAddCommentInput } from '../validations/comment.validation';
import { CommentService } from '../lib/services/comment.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

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
            kind: validatedInput.kind,
            has_attachments: validatedInput.has_attachments,
            text: validatedInput.text,
            content_type: validatedInput.content_type,
            inline_images: validatedInput.inline_images,
            mentions: validatedInput.mentions,
            attachments: validatedInput.attachments,
            reply_to_comment_id: validatedInput.reply_to_comment_id,
            reply_to_invocation_id: validatedInput.reply_to_invocation_id,
          });
          const userId = typeof context === "string" ? getMcpExecutionContext(context)?.user.id : undefined;
          const inlineAgentImages = userId && addParams.attachments?.length && addParams.inline_images !== false
            ? await isFeatureEnabled(HTPR_7514_INLINE_AGENT_IMAGES_FLAG, userId) : false;
          const result = await service.addComment(addParams, invocation, { inlineAgentImages });
          return result;
        }

        if (validatedInput.action === 'update') {
          const result = await service.updateComment({
            comment_id: validatedInput.comment_id!,
            text: validatedInput.text!,
            content_type: validatedInput.content_type,
            inline_images: validatedInput.inline_images,
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
