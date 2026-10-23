import { z } from 'zod'
import { TOOL_METADATA } from '../config/tool-metadata'
import { HelloService } from '../lib/services/hello.service'
import { executeWithService } from '../utils/executeWithService'

export const listFeaturesTool = {
  name: TOOL_METADATA.LIST_FEATURES.name,
  description: TOOL_METADATA.LIST_FEATURES.description,
  parameters: z.object({}).strict(),
  execute: async (_args: unknown, token: string) =>
    executeWithService(token, HelloService, (service) => service.listFeatures(), undefined),
}
