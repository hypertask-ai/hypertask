import { Prisma, type Project } from '@prisma/client'
import { randomBytes } from 'crypto'
import prisma from '@/lib/prisma'
import { assertBoardRoom, isPlanLimitsEnabled, scopeForProject, type PlanLimitContext } from '@/lib/planLimits'
import { assertBoardQuota } from './boardQuota'

const PROJECT_NAME_CREATE_MAX_ATTEMPTS = 5

type ProjectCreateData = Omit<Prisma.ProjectUncheckedCreateInput, 'name'>

function isProjectNameUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code !== 'P2002') return false
  const target = error.meta?.target
  return Array.isArray(target) && target.includes('name')
}

export async function createProjectWithStableName(
  data: ProjectCreateData,
  context: PlanLimitContext,
  transaction?: Prisma.TransactionClient,
): Promise<Project> {
  if (!(await isPlanLimitsEnabled(context.actorUserId))) {
    await assertBoardQuota(data.ownerId)
    return createProvisionedProjectWithStableName(data, transaction)
  }
  if (transaction) {
    await assertBoardRoom(transaction, scopeForProject({ teamId: data.teamId ?? null, ownerId: data.ownerId }), data.status && data.status !== 'Normal' ? 0 : 1, context)
    return createProvisionedProjectWithStableName(data, transaction)
  }
  return prisma.$transaction((tx) => createProjectWithStableName(data, context, tx))
}

export async function createProvisionedProjectWithStableName(
  data: ProjectCreateData,
  transaction?: Prisma.TransactionClient,
) {
  const db = transaction ?? prisma
  for (let attempt = 0; attempt < PROJECT_NAME_CREATE_MAX_ATTEMPTS; attempt++) {
    const provisionalName = `n${randomBytes(8).toString('hex')}`
    try {
      const created = await db.project.create({
        data: { ...data, name: provisionalName }
      })
      return await db.project.update({
        where: { id: created.id },
        data: { name: `project-${created.id}` }
      })
    } catch (error) {
      if (transaction || !isProjectNameUniqueViolation(error)) throw error
      if (attempt === PROJECT_NAME_CREATE_MAX_ATTEMPTS - 1) throw error
    }
  }
  throw new Error('Failed to create project with a unique name')
}
