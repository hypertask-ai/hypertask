import { featureFlagCandidateUserIds, isFeatureEnabled } from '@/lib/flags'
import { HTPR_7195_AI_FEEDBACK_FLAG } from '@/lib/flags/definitions/htpr-7195-ai-feedback'

export async function aiFeedbackEnabled(userId?: number): Promise<boolean> {
  try {
    return userId === undefined
      ? await featureFlagCandidateUserIds(HTPR_7195_AI_FEEDBACK_FLAG) === null
      : await isFeatureEnabled(HTPR_7195_AI_FEEDBACK_FLAG, userId)
  } catch {
    return false
  }
}
