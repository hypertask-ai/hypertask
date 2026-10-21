import { z } from 'zod'
import { getRedis } from '@/lib/redis'

export const cliErrorReportSchema = z.object({
  command: z.string().min(1).max(60).regex(/^[a-z0-9-]+(?: [a-z0-9-]+){0,2}(?![\s\S])/),
  error: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}(?![\s\S])/),
  status: z.number().int().min(100).max(599).optional(),
  version: z.string().max(32).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?![\s\S])/),
  os: z.enum(['linux', 'macos', 'windows', 'other']),
}).strict()

export const CLI_ERROR_QUOTA_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
return count
`

export async function reserveCliErrorReport(userId: number): Promise<boolean> {
  const redis = await getRedis()
  return Number(await redis.eval(CLI_ERROR_QUOTA_SCRIPT, 1, `cli-error:quota:${userId}`)) <= 30
}
