import { LogType, Status, type Priority, type Estimate } from '@prisma/client'
import prisma from '@/lib/prisma'
import { generalConfig } from '@/lib/configs/general.config'
import generateRank from '@/utils/generateRank'
import {
  createProjectViewAndCreateDefault,
  updateUniqueIdentifier
} from '@/utils/controllers/projects/create'
import { enqueueBoardCreated, processAnalyticsIntentSoon, type CreationChannel } from '@/lib/telemetry/savedWork'
import { createProjectWithStableName } from '@/utils/controllers/projects/createProjectWithStableName'
import { assertBoardRoom, assertTicketRoom, isPlanLimitsEnabled } from '@/lib/planLimits'
import { PriorityConstants, EstimateConstants } from '@/lib/constants/constants'
import { persistTaskCreatedWebhook } from '@/lib/mcp/webhooks/taskEvents'
import { publishBoardWebhookDeliveries } from '@/lib/mcp/webhooks/outbox'
import { persistAgentTaskCreatedPending } from '@/lib/agentWebhooks/outbox'
import { schedulePostCreateWork, createPriorityActivity, type TaskCreatedGlobally } from '@/lib/api/task-writes/create-global-effects'
import { enqueueTaskCreated } from '@/lib/telemetry/savedWork'
import { waitUntil } from '@vercel/functions'
import createLog from '@/utils/controllers/logs/createLog'
import { CreateLogInput, type IUser, type IEstimate } from '@/models/model'
import createEstimateActivity from '@/utils/controllers/activities/createEstimateActivity'
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
  creation: ManifestBoardCreation
}

export interface ManifestBoardCreation {
  method: 'api' | 'agent' | 'seeded'
  channel: CreationChannel
  agentId?: string | null
  firstTaskPointerIndex?: number
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

export async function createBoardFromManifest(
  params: CreateBoardFromManifestParams
): Promise<CreateBoardFromManifestResult> {
  const { teamId, googleAccountId, manifest, userId, userEmail, userDisplayName, creation } = params

  if (await isPlanLimitsEnabled(userId)) return createManifestBoardAtomically(params)

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
    },
    ...(creation.agentId ? { members: { create: { userId, agentId: creation.agentId, status: 'Accepted' } } } : {})
  }, { actorUserId: userId, agentId: creation.agentId, entryPoint: 'boards.createBoardFromManifest' })

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
        labels: labelIds,
        creationChannel: creation.channel,
        analyticsAgentId: creation.agentId
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

    try {
      processAnalyticsIntentSoon(await enqueueBoardCreated(prisma, projectId, creation.method, { userId, agentId: creation.agentId }, project.createdAt))
    } catch {
      console.error('[saved-work-analytics] intent enqueue failed')
    }
    return result
  } catch (err) {
    await compensateFailedBoard(projectId)
    throw err
  }
}

async function createManifestBoardAtomically(
  params: CreateBoardFromManifestParams
): Promise<CreateBoardFromManifestResult> {
  const { teamId, googleAccountId, manifest, userId, userDisplayName, creation } = params
  const context = { actorUserId: userId, agentId: creation.agentId, entryPoint: 'boards.createBoardFromManifest' }
  const scope = { kind: 'team' as const, teamId }
  const actor = { userId, agentId: creation.agentId ?? null }
  const taskAuthorId = creation.method === 'seeded' ? generalConfig.hyperAiId : userId
  const committed = await prisma.$transaction(async (tx) => {
    await assertBoardRoom(tx, scope, 1, context)
    await assertTicketRoom(tx, scope, manifest.tasks.length, context)
    let previousRank: string | undefined
    const project = await createProjectWithStableName({
      ownerId: userId,
      seeded: creation.method === 'seeded',
      title: manifest.title,
      description: manifest.description,
      teamId,
      googleAccountId,
      sections: manifest.sections.map((section) => section.title),
      section: { create: manifest.sections.map((section) => {
        previousRank = generateRank(previousRank, undefined)
        return { section_title: section.title, ranking: previousRank, visibility: true, deleted: false }
      }) },
      ...(creation.agentId ? { members: { create: { userId, agentId: creation.agentId, status: 'Accepted' } } } : {}),
    }, context, tx)
    const projectId = project.id
    const identifier = await updateUniqueIdentifier(teamId, manifest.title, projectId, tx)
    const sectionRows = await tx.section.findMany({ where: { projectId }, orderBy: { ranking: 'asc' } })
    const labels: CreateBoardLabelResult[] = []
    const nameToLabelId = new Map<string, string>()
    for (const label of manifest.labels) {
      const created = await tx.label.create({ data: { projectId, value: label.name } })
      nameToLabelId.set(label.name, created.id)
      labels.push({ id: created.id, name: label.name, color: label.color })
    }
    const tasks: CreateBoardTaskResult[] = []
    const createdTasks: (TaskCreatedGlobally & { priority: Priority | null; estimate: Estimate | null })[] = []
    const analyticsKeys: string[] = []
    const deliveryIds: string[] = []
    const sectionRanks = new Map<number, string>()
    for (const [index, task] of manifest.tasks.entries()) {
      const section = sectionRows[task.sectionIndex]
      const priority = PriorityConstants.find((value) => value.priority_index === task.priority)
      const estimate = EstimateConstants.find((value) => value.estimate_index === task.estimate)
      const ranking = generateRank(sectionRanks.get(section.id), undefined)
      sectionRanks.set(section.id, ranking)
      await assertTicketRoom(tx, scope, 1, context)
      const created = await tx.task.create({
        data: {
          projectId,
          title: task.title,
          description: '',
          description_: { create: { content: task.description ?? '', creatorId: taskAuthorId, agentId: creation.agentId } },
          userId: taskAuthorId,
          agentId: creation.agentId ?? null,
          uniqueIndex: index + 1,
          ticketNumber: `${identifier}-${index + 1}`,
          sectionId: section.id,
          section: section.section_title,
          ranking,
          status: Status.Normal,
          dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
          updatedAt: new Date(),
          taskLabels: { create: task.labelNames.map((name) => ({ labelId: nameToLabelId.get(name)! })) },
          ...(task.priority > 0 && priority ? { priority: { create: {
            projectId, sectionId: section.id, addedByUserId: userId, addedByAgentId: creation.agentId,
            priority_index: priority.priority_index, Priority_Value: priority.Priority_Value,
          } } } : {}),
          ...(task.estimate > 0 && estimate ? { estimate: { create: {
            projectId, sectionId: section.id, addedByUserId: userId, addedByAgentId: creation.agentId,
            estimate_index: estimate.estimate_index, estimate_value: estimate.estimate_value,
          } } } : {}),
        },
        include: { priority: true, estimate: true, project: true, parentTask: true, description_: true },
      })
      await persistAgentTaskCreatedPending(tx, created.id)
      createdTasks.push(created)
      deliveryIds.push(...await persistTaskCreatedWebhook(tx, {
        id: created.id, ticketNumber: created.ticketNumber, projectId,
        title: created.title, status: 'Normal', dueDate: created.dueDate,
        startDate: created.startDate, sectionId: section.id, section: section.section_title,
        priority: created.priority,
      }, userId, creation.agentId ?? null))
      analyticsKeys.push(await enqueueTaskCreated(tx, created.id, actor, creation.channel))
      tasks.push({
        id: created.id, ticketNumber: created.ticketNumber ?? undefined,
        uniqueIndex: index + 1, projectId, title: created.title, sectionId: section.id,
        link: { url: buildMcpTaskUrl(projectId, index + 1), format: 'detail', example: buildMcpTaskUrl(projectId, index + 1) },
      })
    }
    if (creation.firstTaskPointerIndex != null) {
      const pointer = tasks[creation.firstTaskPointerIndex]
      if (!pointer) throw new Error('First task pointer is missing from manifest')
      await tx.project.update({ where: { id: projectId }, data: { firstTaskPointerTaskId: pointer.id, firstTaskPointerSectionId: pointer.sectionId } })
    }
    await createProjectViewAndCreateDefault({ projectId, userId }, tx)
    analyticsKeys.push(await enqueueBoardCreated(tx, projectId, creation.method, actor, project.createdAt))
    const result: CreateBoardFromManifestResult = {
      board: { id: projectId, title: project.title ?? '', name: project.name, status: 'Normal', team_id: teamId, link: { url: buildMcpBoardUrl(projectId), format: 'project' } },
      sections: sectionRows.map((section, index) => ({
        id: section.id, section_title: section.section_title, ranking: section.ranking,
        taskCount: manifest.tasks.filter((task) => task.sectionIndex === index).length,
      })),
      labels,
      tasks,
    }
    return { result, analyticsKeys, deliveryIds, createdTasks }
  }, { timeout: 60000 })

  for (const key of committed.analyticsKeys) processAnalyticsIntentSoon(key)
  for (const task of committed.createdTasks) {
    schedulePostCreateWork({ task, userId, projectId: task.projectId, originUserId: userId, agentId: creation.agentId })
  }
  waitUntil(Promise.allSettled([
    publishBoardWebhookDeliveries(committed.deliveryIds),
    (async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, displayName: true, photoURL: true } })
      for (const task of committed.createdTasks) {
        if (task.priority) await createPriorityActivity(task, user as IUser, task.priority)
        if (task.estimate) await createEstimateActivity({
          fromUser: user as IUser, taskId: task.id,
          toEstimate: { ...task.estimate, estimate: task.estimate as unknown as IEstimate },
        })
      }
    })(),
    ...committed.createdTasks.filter((task) => task.dueDate).map(async (task) => {
      const { scheduleDueDateJob } = await import('@/pages/api/queues/duedateQueue')
      await scheduleDueDateJob({ taskId: task.id, projectId: task.projectId }, task.dueDate!)
    }),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') console.error('[MCP Create Board] post-create handoff failed:', result.reason)
    }
  }))
  try {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { title: true } })
    createLog({
      log: `${userDisplayName || 'User'} created a board "${manifest.title}" in team "${team?.title ?? ''}"`,
      type: LogType.Board, status: Status.Normal, LoggedById: userId,
    })
  } catch (error) {
    console.error('[MCP Create Board] log after success:', error)
  }
  return committed.result
}
