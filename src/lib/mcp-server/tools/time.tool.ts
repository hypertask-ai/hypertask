import { TimeService } from '../lib/services/time.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getTimeBaseSchema, type TimeInput } from '../validations/time.validation';

const TimeBaseSchema = getTimeBaseSchema();

export const timeTool = {
  name: TOOL_METADATA.TIME.name,
  description: TOOL_METADATA.TIME.description,
  parameters: TimeBaseSchema,
  execute: async (args: unknown, context: any) => {
    const input = TimeBaseSchema.parse(args);
    const taskActions = ['start', 'stop', 'status', 'log'];

    if (taskActions.includes(input.action) && !input.task) {
      return `Error: task is required for action=${input.action}`;
    }
    if (input.action === 'log' && input.minutes === undefined) {
      return 'Error: minutes is required for action=log';
    }

    switch (input.action) {
      case 'start':
        return executeWithService(
          context,
          TimeService,
          (service, actionInput) => service.start(actionInput),
          { task: input.task! }
        );
      case 'stop':
        return executeWithService(
          context,
          TimeService,
          (service, actionInput) => service.stop(actionInput),
          { task: input.task! }
        );
      case 'status':
        return executeWithService(
          context,
          TimeService,
          (service, actionInput) => service.status(actionInput),
          { task: input.task! }
        );
      case 'log':
        return executeWithService(
          context,
          TimeService,
          (service, actionInput) => service.log(actionInput),
          { task: input.task!, minutes: input.minutes! }
        );
      case 'running':
        return executeWithService(
          context,
          TimeService,
          (service) => service.running(),
          undefined
        );
      case 'report': {
        const reportInput: Omit<TimeInput, 'action' | 'minutes'> = {
          board: input.board,
          task: input.task,
          user: input.user,
          from: input.from,
          to: input.to,
          running: input.running,
        };
        return executeWithService(
          context,
          TimeService,
          (service, actionInput) => service.report(actionInput),
          reportInput
        );
      }
    }
  },
};
