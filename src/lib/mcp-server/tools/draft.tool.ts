import {
  validateAndSanitizeDraftCrudInput,
  getDraftCrudBaseSchema,
  validateAndSanitizeCreateDraftInput,
} from '../validations/draft.validation';
import { DraftService } from '../lib/services/draft.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

const DraftCrudBaseSchema = getDraftCrudBaseSchema();

export const draftTool = {
  name: TOOL_METADATA.DRAFT_CRUD.name,
  description: TOOL_METADATA.DRAFT_CRUD.description,
  parameters: DraftCrudBaseSchema,
  execute: async (args: unknown, context: any) => {
    const rawArgs = args as Record<string, any>;
    const action = rawArgs?.action ?? 'create';

    const normalizedArgs = action === 'create' || action === 'list' ? normalizeTaskInput(rawArgs) : rawArgs;

    const validatedInput = validateAndSanitizeDraftCrudInput(normalizedArgs);

    return executeWithService(
      context,
      DraftService,
      async (service) => {
        if (validatedInput.action === 'create') {
          const createParams = validateAndSanitizeCreateDraftInput({
            task_id: validatedInput.task_id,
            ticket_number: validatedInput.ticket_number,
            project_id: validatedInput.project_id,
            unique_index: validatedInput.unique_index,
            draft_type: validatedInput.draft_type,
            text: validatedInput.text,
          });
          const result = await service.createDraft(createParams);
          return { success: true, draft: result.draft, message: result.message };
        }

        if (validatedInput.action === 'list') {
          const result = await service.listDrafts({
            task_id: validatedInput.task_id,
            ticket_number: validatedInput.ticket_number,
            project_id: validatedInput.project_id,
            unique_index: validatedInput.unique_index,
          });
          return { success: true, drafts: result.drafts };
        }

        if (validatedInput.action === 'update') {
          const result = await service.updateDraft({
            draft_id: validatedInput.draft_id!,
            text: validatedInput.text!,
          });
          return { success: true, draft: result.draft, message: result.message };
        }

        if (validatedInput.action === 'publish') {
          const result = await service.publishDraft({
            draft_id: validatedInput.draft_id!,
          });
          return { success: true, draft: result.draft, message: result.message };
        }

        if (validatedInput.action === 'delete') {
          const result = await service.deleteDraft({
            draft_id: validatedInput.draft_id!,
          });
          return { success: true, message: result.message };
        }

        throw new Error(`Unknown action: ${(validatedInput as any).action}`);
      },
      validatedInput
    );
  },
};
