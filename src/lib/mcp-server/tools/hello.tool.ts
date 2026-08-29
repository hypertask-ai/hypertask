import { z } from 'zod';
import { TOOL_METADATA } from '../config/tool-metadata';
import { HelloService } from '../lib/services/hello.service';
import { executeWithService } from '../utils/executeWithService';

export const helloTool = {
  name: TOOL_METADATA.HELLO.name,
  description: TOOL_METADATA.HELLO.description,
  parameters: z.object({}).strict(),
  execute: async (_args: unknown, context: any) =>
    executeWithService(
      context,
      HelloService,
      (service) => service.getHello(),
      undefined
    ),
};
