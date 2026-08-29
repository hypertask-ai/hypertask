import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { runTaskWriteProbe } from '@/lib/taskCardActions/writeProbe'
import { createTaskWriteProbeHandler } from '@/lib/mcp/taskWriteProbe/probeHandler'

// The probe result is a live database write; never cache it.
export const dynamic = 'force-dynamic'

// Real auth (the same bearer-token path the existing health check uses for
// GET /api/mcp/projects) + the real advisory-lock write path from writeLocks.ts.
export const GET = createTaskWriteProbeHandler({
  checkRateLimit: checkMcpRateLimit,
  validateAuth: validateMcpAuth,
  runProbe: runTaskWriteProbe,
})