import { Prisma } from '@prisma/client'
import { randomBytes } from 'crypto'
import prisma from '@/lib/prisma'

const PROJECT_NAME_CREATE_MAX_ATTEMPTS = 5

function isProjectNameUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code !== 'P2002') return false
  const target = error.meta?.target
  return Array.isArray(target) && target.includes('name')
}

/**
 * Creates a project with a guaranteed-unique `name`: insert under a random
 * provisional name, then rename to `project-${id}` (stable and unique).
 * Retries if the provisional name collides (extremely unlikely).
 */
export async function createProjectWithStableName(
  data: Omit<Prisma.ProjectUncheckedCreateInput, 'name'>
) {
  for (let attempt = 0; attempt < PROJECT_NAME_CREATE_MAX_ATTEMPTS; attempt++) {
    const provisionalName = `n${randomBytes(8).toString('hex')}`
    try {
      const created = await prisma.project.create({
        data: { ...data, name: provisionalName }
      })
      return await prisma.project.update({
        where: { id: created.id },
        data: { name: `project-${created.id}` }
      })
    } catch (error) {
      if (!isProjectNameUniqueViolation(error)) throw error
      if (attempt === PROJECT_NAME_CREATE_MAX_ATTEMPTS - 1) throw error
    }
  }
  throw new Error('Failed to create project with a unique name')
}
