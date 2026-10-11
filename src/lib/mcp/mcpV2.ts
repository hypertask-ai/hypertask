import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_6927_MCP_V2_FLAG } from '@/lib/flags/keys'

export async function isMcpV2Enabled(userId: number): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return false
  try {
    return await isFeatureEnabled(HTPR_6927_MCP_V2_FLAG, userId)
  } catch {
    return false
  }
}
