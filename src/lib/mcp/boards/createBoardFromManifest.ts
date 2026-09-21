import { LogType, Status } from '@prisma/client'
import prisma from '@/lib/prisma'
import generateRank from '@/utils/generateRank'
import {
  createProjectViewAndCreateDefault,
  updateUniqueIdentifier
} from '@/utils/controllers/projects/create'
import { createProjectWithStableName } from '@/utils/controllers/projects/createProjectWithStableName'
import { assertBoardQuota } from '@/utils/controllers/projects/boardQuota'
import createLog from '@/utils/controllers/logs/createLog'
import { CreateLogInput } from '@/models/model'
import { createTask } from '@/lib/mcp/tasks/services'
import { buildMcpBoardUrl, buildMcpTaskUrl } from './links'
import type { ValidatedBoardManifest } from './types'

export interface CreateBoardFromManifestParams {
  teamId: string
  googleAccountId: string
  manifest: ValidatedBoardManifest
  userId: number
  userEmail: string
  userDisplayName?: string | null
}

export interface CreateBoardSectionResult {
  id: number
  section_title: string
  ranking: string
  taskCount: number
}

export interface CreateBoardLabelResult {
  id: string
  name: string
  color?: string
}

export interface CreateBoardTaskResult {
  id: number
  ticketNumber?: string
  uniqueIndex?: number
  projectId: number
  title: string
  sectionId: number
  link?: { url: string; format?: string; example?: string }
}

export interface CreateBoardFromManifestResult {
  board: {
    id: number
    title: string
    name: string
    status: 'Normal'
    team_id?: string
    link?: { url: string; format?: string }
  }
  sections: CreateBoardSectionResult[]
  labels: CreateBoardLabelResult[]
  tasks: CreateBoardTaskResult[]
}

async function compensateFailedBoard(projectId: number): Promise<void> {
  await prisma.task.updateMany({
    where: { projectId },
    data: { status: 'Deleted' }
  })
  await prisma.project.update({
    where: { id: projectId },
    data: { status: Status.Deleted }
  })
}

/**
 * Creates a project (board) from a validated manifest: custom columns, labels, starter tasks.
 * On failure after the project exists, soft-deletes tasks and project (no DB schema changes).
 */
export async function createBoardFromManifest(
  params: CreateBoardFromManifestParams
): Promise<CreateBoardFromManifestResult> {
  const { teamId, googleAccountId, manifest, userId, userEmail, userDisplayName } = params

  // HTPR-4894: MCP, the CLI and the AI chat tool all create boards through here,
  // so the free-plan cap lives here rather than in each of them.
  await assertBoardQuota(userId)

  let prevRank: string | undefined
  const sectionCreates = manifest.sections.map((s) => {
    const ranking = generateRank(prevRank, undefined)
    prevRank = ranking
    return {
      section_title: s.title,
      ranking,
      visibility: true,
      deleted: false
    }
  })

  const sectionTitles = manifest.sections.map((s) => s.title)

  const projectCore = await createProjectWithStableName({
    ownerId: userId,
    title: manifest.title,
    description: manifest.description ?? undefined,
    teamId,
    googleAccountId,
    sections: sectionTitles,
    section: {
      create: sectionCreates
    }
  })

  const projectId = projectCore.id

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      owner: true,
      team: { select: { title: true } }
    }
  })

  try {
    await createProjectViewAndCreateDefault({ projectId, userId })
    await updateUniqueIdentifier(teamId, manifest.title, projectId)

    const projectRow = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        name: true,
        uniqueIdentifier: true,
        teamId: true
      }
    })

    if (!projectRow.uniqueIdentifier) {
      throw new Error('Could not assign project unique identifier')
    }

    const sectionRows = await prisma.section.findMany({
      where: { projectId, deleted: false },
      orderBy: { ranking: 'asc' }
    })

    const titleToSection = new Map(sectionRows.map((s) => [s.section_title, s]))
    const sectionIdByIndex = manifest.sections.map((s, idx) => {
      const sec = titleToSection.get(s.title)
      if (!sec) {
        throw new Error(`Section "${s.title}" missing after create (index ${idx})`)
      }
      return sec.id
    })

    const labelsOut: CreateBoardLabelResult[] = []
    const nameToLabelId = new Map<string, string>()

    for (const lb of manifest.labels) {
      const created = await prisma.label.create({
        data: {
          value: lb.name,
          projectId
        }
      })
      nameToLabelId.set(lb.name, created.id)
      labelsOut.push({
        id: created.id,
        name: lb.name,
        color: lb.color
      })
    }

    const tasksOut: CreateBoardTaskResult[] = []

    for (const task of manifest.tasks) {
      const sectionId = sectionIdByIndex[task.sectionIndex]
      const sectionTitle = manifest.sections[task.sectionIndex].title
      const labelIds = task.labelNames.map((n) => {
        const id = nameToLabelId.get(n)
        if (!id) {
          throw new Error(`Label id missing for "${n}"`)
        }
        return id
      })

      const createdTask = await createTask({
        projectId,
        title: task.title,
        description: task.description ?? '',
        sectionId,
        sectionTitle,
        userId,
        priorityIndex: task.priority,
        estimateIndex: task.estimate,
        dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
        projectUniqueIdentifier: projectRow.uniqueIdentifier,
        teamId,
        labels: labelIds
      })

      const uniqueIndex = createdTask.uniqueIndex
      if (uniqueIndex == null) {
        throw new Error('Created task is missing uniqueIndex')
      }

      tasksOut.push({
        id: createdTask.id,
        ticketNumber: createdTask.ticketNumber || undefined,
        uniqueIndex,
        projectId: createdTask.projectId,
        title: createdTask.title,
        sectionId,
        link: {
          url: buildMcpTaskUrl(createdTask.projectId, uniqueIndex),
          format: 'detail',
          example: buildMcpTaskUrl(createdTask.projectId, uniqueIndex)
        }
      })
    }

    const sectionsWithCounts: CreateBoardSectionResult[] = await Promise.all(
      sectionRows.map(async (sec) => ({
        id: sec.id,
        section_title: sec.section_title,
        ranking: sec.ranking,
        taskCount: await prisma.task.count({
          where: {
            projectId,
            section: sec.section_title,
            status: 'Normal'
          }
        })
      }))
    )

    const result: CreateBoardFromManifestResult = {
      board: {
        id: projectId,
        title: project.title || '',
        name: `project-${projectId}`,
        status: 'Normal',
        team_id: teamId,
        link: {
          url: buildMcpBoardUrl(projectId),
          format: 'project'
        }
      },
      sections: sectionsWithCounts,
      labels: labelsOut,
      tasks: tasksOut
    }

    try {
      const ownerName = userDisplayName || project.owner?.displayName || 'User'
      const createLogBody: CreateLogInput = {
        log: `${ownerName} created a board "${project.title}" in team "${project.team?.title ?? ''}"`,
        type: LogType.Board,
        status: Status.Normal,
        LoggedById: userId
      }
      createLog(createLogBody)
    } catch (sideEffectErr) {
      console.error('[MCP Create Board] log after success:', sideEffectErr)
    }

    return result
  } catch (err) {
    await compensateFailedBoard(projectId)
    throw err
  }
}
