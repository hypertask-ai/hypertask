import { getAttachFilesBaseSchema } from '../validations/attachment.validation';
import { AttachmentService } from '../lib/services/attachment.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

const AttachFilesBaseSchema = getAttachFilesBaseSchema();

export const attachFilesTool = {
  name: TOOL_METADATA.ATTACH_FILES.name,
  description: TOOL_METADATA.ATTACH_FILES.description,
  parameters: AttachFilesBaseSchema,
  execute: async (args: unknown, context: any) => {
    const normalizedArgs = normalizeTaskInput((args || {}) as Record<string, any>);
    const validatedInput = normalizedArgs;

    return executeWithService(
      context,
      AttachmentService,
      'attachFiles',
      validatedInput
    );
  },
};
