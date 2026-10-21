import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7298_STANDALONE_PAGES_FLAG } from '@/lib/flags/keys'

export function standalonePagesEnabled(userId: number): Promise<boolean> {
  return isFeatureEnabled(HTPR_7298_STANDALONE_PAGES_FLAG, userId)
}
