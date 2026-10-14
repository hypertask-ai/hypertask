import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { runTaskWriteProbe } from '@/lib/taskCardActions/writeProbe'
import { createTaskWriteProbeHandler } from '@/lib/mcp/taskWriteProbe/probeHandler'

export const dynamic = 'force-dynamic'

export const GET = createTaskWriteProbeHandler({
  checkRateLimit: checkMcpRateLimit,
  validateAuth: validateMcpAuth,
  runProbe: runTaskWriteProbe,
})