import prisma from '@/lib/prisma'
import { DEFAULT_BRAIN_LABEL_NAME, brainLabelsFromBoard, enforceBrainLabel } from '@/lib/ai/taskWriterBrainLabels'

export async function defaultAgentBrainLabelIds(projectId: number, ids: readonly string[]): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(9402, ${projectId})`
    const labels = await tx.label.findMany({ where: { projectId }, select: { id: true, value: true } })
    const brain = brainLabelsFromBoard(labels)
    if (brain && ids.some((id) => brain.ids.has(id))) return [...ids]
    const medium = labels.find((label) => label.value?.trim().toLowerCase() === DEFAULT_BRAIN_LABEL_NAME)
    if (medium) return enforceBrainLabel(ids, brain)
    const created = await tx.label.create({ data: { projectId, value: DEFAULT_BRAIN_LABEL_NAME }, select: { id: true } })
    return [...ids, created.id]
  })
}
