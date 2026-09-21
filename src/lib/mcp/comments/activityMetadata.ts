import type { Prisma } from '@prisma/client'

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
  activity: Prisma.JsonValue | null
): T & ActivityEntryMetadata {
  return {
    ...entry,
    type: activity == null ? 'comment' : 'activity',
    activity: activity ?? null
  }
}
