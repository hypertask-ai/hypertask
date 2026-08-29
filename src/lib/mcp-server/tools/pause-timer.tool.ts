import { TOOL_METADATA } from '../config/tool-metadata';
import { TimeService } from '../lib/services/time.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getTimeTaskBaseSchema,
  TimeTaskInputSchema,
} from '../validations/time.validation';

export const pauseTimerTool = {
  name: TOOL_METADATA.PAUSE_TIMER.name,
  description: TOOL_METADATA.PAUSE_TIMER.description,
  parameters: getTimeTaskBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = TimeTaskInputSchema.parse(args);
    return executeWithService(context, TimeService, 'pause', validatedInput);
  },
};
