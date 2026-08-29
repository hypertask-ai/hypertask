import { TOOL_METADATA } from '../config/tool-metadata';
import { TimeService } from '../lib/services/time.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getTimeTaskBaseSchema,
  TimeTaskInputSchema,
} from '../validations/time.validation';

export const resumeTimerTool = {
  name: TOOL_METADATA.RESUME_TIMER.name,
  description: TOOL_METADATA.RESUME_TIMER.description,
  parameters: getTimeTaskBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = TimeTaskInputSchema.parse(args);
    return executeWithService(context, TimeService, 'resume', validatedInput);
  },
};
