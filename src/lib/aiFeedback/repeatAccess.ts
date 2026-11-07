import type { Prisma } from '@prisma/client'
import { HTPR_8894_FEEDBACK_REPEAT_ACTIVITY_FLAG } from '@/lib/flags/definitions/htpr-8894-feedback-repeat-activity'
import { feedbackToolSlug } from './input'

const open = { not: 'Deleted' as const }

export const FEEDBACK_BOARD_ID = 15

const FINGERPRINT = 'Fingerprint: ai-fb-'

export async function feedbackRepeatActivityEnabled(userId?: number): Promise<boolean> {
  if (userId === undefined || !Number.isSafeInteger(userId) || userId <= 0) return false
  try {
    const { isFeatureEnabled } = await import('@/lib/flags')
    return await isFeatureEnabled(HTPR_8894_FEEDBACK_REPEAT_ACTIVITY_FLAG, userId)
  } catch {
    return false
  }
}

export async function withFeedbackToolSlug(raw: unknown, userId?: number): Promise<unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const body = raw as Record<string, unknown>
  if (typeof body.tool !== 'string') return raw
  const tool = feedbackToolSlug(body.tool)
  if (!tool || tool === body.tool) return raw
  if (!await feedbackRepeatActivityEnabled(userId)) return raw
  return { ...body, tool }
}

export function feedbackReportWhere(taskId: number, project: Prisma.ProjectWhereInput): Prisma.TaskWhereInput {
  return {
    id: taskId,
    projectId: FEEDBACK_BOARD_ID,
    status: open,
    project: { ...project, status: open },
    OR: [
      { description: { contains: FINGERPRINT } },
      { description_: { is: { content: { contains: FINGERPRINT } } } },
      { comments: { some: { text: { contains: FINGERPRINT } } } },
      { taskLabels: { some: { label: { value: 'ai-feedback' } } } },
    ],
  }
}
