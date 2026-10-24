import { isFeatureEnabled } from '@/lib/flags';
import { HTPR_7843_SECTIONS_ROLE_FLAG } from '@/lib/flags/keys';
import { getMcpExecutionContext } from '@/lib/mcp/operationContext';
import { getSectionCrudBaseSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { SectionService } from '../lib/services/section.service';

export const sectionTool = {
  name: TOOL_METADATA.SECTION_CRUD.name,
  description: TOOL_METADATA.SECTION_CRUD.description,
  parameters: getSectionCrudBaseSchema(),
  execute: async (args: unknown, context: unknown) => {
    const validatedInput = args;
    const userId = typeof context === 'string' ? getMcpExecutionContext(context)?.user.id : undefined;
    const roleEnabled = Boolean(userId) && await isFeatureEnabled(HTPR_7843_SECTIONS_ROLE_FLAG, userId as number).catch(() => false);
    return executeWithService(
      context,
      SectionService,
      (service, input: unknown) => service.manageSection(input, { roleEnabled }),
      validatedInput
    );
  },
};
