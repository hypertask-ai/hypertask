import type { Prisma } from '@prisma/client'
import { gateActivityAgentAttribution } from '@/lib/agents/activityAttribution'

export interface ActivityEntryMetadata {
  type: 'comment' | 'activity'
  activity: Prisma.JsonValue | null
}

/**
 * Preserve the raw activity payload returned by the app comment endpoint while
 * adding an explicit discriminator for API callers.
 */
export function withActivityMetadata<T extends object>(
  entry: T,
  activity: Prisma.JsonValue | null,
  attributionEnabled = false
): T & ActivityEntryMetadata {
  return {
    ...entry,
    type: activity == null ? 'comment' : 'activity',
    activity: gateActivityAgentAttribution(activity, attributionEnabled) ?? null
  }
}
