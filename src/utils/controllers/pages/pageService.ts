import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import {
  convertToPlain,
  deletePageFromTurbopuffer,
  upsertPageToTurbopuffer,
} from '@/utils/controllers/turbopuffer/turbopufferHelper'
import { markdownToHtml } from '@/utils/helperFunctions/markdownToHtml'
import { sanitizeRichHtml } from '@/utils/helperFunctions/sanitizeRichHtml'
import { decodeHtmlCanvas, extractCanvasText, wrapHtmlCanvas } from './htmlCanvas'

export type PageContentType = 'html' | 'markdown' | 'html_canvas'
export type PageUpdateMode = 'replace' | 'append' | 'prepend'

export class PageConflictError extends Error {
  readonly currentVersion: number
  readonly currentContent: { html: string; text: string }

  constructor(currentVersion: number, currentContent: { html: string; text: string }) {
    super(`Page version conflict: current version is ${currentVersion}`)
    this.name = 'PageConflictError'
    this.currentVersion = currentVersion
    this.currentContent = currentContent
  }
}

export function renderPageContent({
  content,
  contentType,
}: {
  content: string
  contentType: PageContentType
}): { html: string; text: string } {
  if (contentType === 'html_canvas') {
    return {
      html: sanitizeRichHtml(wrapHtmlCanvas(content)),
      text: extractCanvasText(content),
    }
  }

  const rendered = contentType === 'markdown' ? markdownToHtml(content) : content
  const html = sanitizeRichHtml(rendered)
  return { html, text: convertToPlain(html) }
}

function mergePageContent({
  currentHtml,
  content,
  contentType,
  mode,
}: {
  currentHtml: string
  content: string
  contentType: PageContentType
  mode: PageUpdateMode
}) {
  const incoming = renderPageContent({ content, contentType })
  if (mode === 'replace') return incoming

  const mergedHtml = mode === 'append'
    ? `${currentHtml}${incoming.html}`
    : `${incoming.html}${currentHtml}`

  return renderPageContent({ content: mergedHtml, contentType: 'html' })
}

type PageSnapshot = {
  id: number
  title: string
  contentHtml: string
  contentText: string
  version: number
}

function createPageSnapshot(
  tx: Prisma.TransactionClient,
  page: PageSnapshot,
  {
    userId,
    agentId,
    note,
  }: {
    userId: number
    agentId?: string | null
    note?: string | null
  }
) {
  return tx.docVersion.create({
    data: {
      entityType: 'page',
      entityId: page.id,
      version: page.version,
      contentHtml: page.contentHtml,
      contentText: page.contentText,
      title: page.title,
      authorId: userId,
      agentId: agentId ?? null,
      note: note ?? null,
    },
  })
}

function queuePageUpsert(pageId: number) {
  void upsertPageToTurbopuffer(pageId).catch((error) => {
    console.error('turbopuffer page indexing failed:', error)
  })
}

function queuePageDelete(pageId: number) {
  void deletePageFromTurbopuffer(pageId).catch((error) => {
    console.error('turbopuffer page deletion failed:', error)
  })
}

export async function createPage({
  taskId,
  projectId,
  title,
  content,
  contentType,
  parentPageId,
  userId,
  agentId,
}: {
  taskId?: number
  projectId?: number
  title?: string
  content: string
  contentType: PageContentType
  parentPageId?: number | null
  userId: number
  agentId?: string | null
}) {
  const rendered = renderPageContent({ content, contentType })

  const page = await prisma.$transaction(async (tx) => {
    if (taskId !== undefined) {
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`
    }
    const task = taskId === undefined ? null : await tx.task.findFirst({
      where: { id: taskId, project: { status: 'Normal', ...getProjectWhere(userId, agentId) } },
      select: { id: true, projectId: true },
    })
    if (taskId !== undefined && !task) throw new Error(`Task with ID ${taskId} not found`)
    const owningProjectId = task?.projectId ?? projectId
    if (owningProjectId === undefined) throw new Error('Page requires a board')

    if (parentPageId != null) {
      const parentPage = await tx.page.findFirst({
        where: {
          id: parentPageId,
          projectId: owningProjectId,
          ...(taskId === undefined ? {} : { OR: [{ taskId }, { links: { some: { taskId } } }] }),
        },
        select: { id: true },
      })
      if (!parentPage) {
        throw new Error(`Parent page with ID ${parentPageId} not found in board ${owningProjectId}`)
      }
    }

    return tx.page.create({
      data: {
        ...(title === undefined ? {} : { title }),
        contentHtml: rendered.html,
        contentText: rendered.text,
        taskId: taskId ?? null,
        ...(taskId === undefined ? {} : {
          links: { create: { taskId, createdById: userId, agentId: agentId ?? null } },
        }),
        parentPageId: parentPageId ?? null,
        projectId: owningProjectId,
        createdById: userId,
        agentId: agentId ?? null,
      },
    })
  })

  queuePageUpsert(page.id)
  return page
}

type GetPageArgs =
  | { publicId: string; id?: never }
  | { id: number; publicId?: never }

const pageTaskSelect = {
  id: true,
  ticketNumber: true,
  title: true,
  projectId: true,
  uniqueIndex: true,
} as const

export async function getPage(args: GetPageArgs & { userId?: number; agentId?: string | null; standalonePagesEnabled?: boolean }) {
  const where = 'id' in args
    ? { id: args.id }
    : { publicId: args.publicId }
  const taskWhere: Prisma.TaskWhereInput = {
    status: { not: 'Deleted' },
    project: {
      status: 'Normal',
      ...(args.userId === undefined ? {} : getProjectWhere(args.userId, args.agentId)),
    },
  }

  const page = await prisma.page.findUnique({
    relationLoadStrategy: 'join',
    where: {
      ...where,
      ...(args.standalonePagesEnabled === false ? { taskId: { not: null } } : {}),
      ...(args.userId === undefined ? {} : {
        project: { status: 'Normal', ...getProjectWhere(args.userId, args.agentId) },
      }),
    },
    include: {
      task: { where: taskWhere, select: pageTaskSelect },
      links: {
        where: { task: taskWhere },
        select: { task: { select: pageTaskSelect } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
      subPages: {
        where: { archived: false, ...(args.standalonePagesEnabled === false ? { taskId: { not: null } } : {}) },
        select: { id: true, title: true, publicId: true, projectId: true },
      },
    },
  })
  if (!page) return null
  const { links, subPages, ...visiblePage } = page
  const linkedTasks = args.standalonePagesEnabled === false
    ? (page.task ? [page.task] : [])
    : links.map(({ task }) => task)
  return {
    ...visiblePage,
    taskId: page.task?.id ?? null,
    linkedTasks,
    subPages: subPages.filter((child) => child.projectId === page.projectId)
      .map(({ projectId: _projectId, ...child }) => child),
  }
}

export async function updatePage({
  id,
  title,
  content,
  contentType,
  mode = 'replace',
  ifVersion,
  note,
  userId,
  agentId,
}: {
  id: number
  title?: string
  content?: string
  contentType?: PageContentType
  mode?: PageUpdateMode
  ifVersion?: number
  note?: string | null
  userId: number
  agentId?: string | null
}) {
  if (title === undefined && content === undefined) {
    throw new Error('Page update requires title or content')
  }

  const page = await prisma.$transaction(async (tx) => {
    const current = await tx.page.findUnique({ where: { id } })
    if (!current) throw new Error(`Page with ID ${id} not found`)

    if (ifVersion !== undefined && ifVersion !== current.version) {
      throw new PageConflictError(current.version, {
        html: current.contentHtml,
        text: current.contentText,
      })
    }

    const nextContent = content === undefined
      ? null
      : mergePageContent({
          currentHtml: current.contentHtml,
          content,
          contentType: contentType ?? (
            decodeHtmlCanvas(current.contentHtml) !== null ? 'html_canvas' : 'markdown'
          ),
          mode,
        })

    await createPageSnapshot(tx, current, { userId, agentId, note })

    const result = await tx.page.updateMany({
      where: { id, version: current.version },
      data: {
        ...(title === undefined ? {} : { title }),
        ...(nextContent === null
          ? {}
          : {
              contentHtml: nextContent.html,
              contentText: nextContent.text,
            }),
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })
    if (result.count === 0) {
      const fresh = await tx.page.findUnique({ where: { id } })
      throw new PageConflictError(fresh?.version ?? current.version, {
        html: fresh?.contentHtml ?? current.contentHtml,
        text: fresh?.contentText ?? current.contentText,
      })
    }

    const updated = await tx.page.findUnique({ where: { id } })
    if (!updated) throw new Error(`Page with ID ${id} not found`)
    return updated
  })

  queuePageUpsert(page.id)
  return page
}

export async function listPages({
  taskId,
  projectId,
  userId,
  agentId,
  standalonePagesEnabled = true,
  archived = false,
  query,
}: {
  taskId?: number
  projectId?: number
  userId?: number
  agentId?: string | null
  standalonePagesEnabled?: boolean
  archived?: boolean
  query?: string
}) {
  const taskWhere: Prisma.TaskWhereInput = {
    status: { not: 'Deleted' },
    project: {
      status: 'Normal',
      ...(userId === undefined ? {} : getProjectWhere(userId, agentId)),
    },
  }
  const pages = await prisma.page.findMany({
    where: {
      archived,
      ...(standalonePagesEnabled
        ? (taskId === undefined ? {} : { OR: [{ links: { some: { taskId } } }, { taskId, links: { none: {} } }] })
        : { taskId: taskId ?? { not: null } }),
      ...(projectId === undefined ? {} : { projectId }),
      project: { status: 'Normal', ...(userId === undefined ? {} : getProjectWhere(userId, agentId)) },
      ...(query?.trim() ? { AND: [{ OR: [
        { title: { contains: query.trim(), mode: 'insensitive' } },
        { contentText: { contains: query.trim(), mode: 'insensitive' } },
      ] }] } : {}),
    },
    select: {
      id: true,
      publicId: true,
      title: true,
      parentPageId: true,
      parentPage: { select: { projectId: true } },
      projectId: true,
      project: { select: { id: true, title: true } },
      updatedAt: true,
      task: { where: taskWhere, select: pageTaskSelect },
      links: {
        where: { task: taskWhere },
        select: { task: { select: pageTaskSelect } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: { updatedAt: 'desc' },
  })
  return pages.map(({ links, task, parentPage, ...page }) => {
    const linkedTasks = standalonePagesEnabled ? links.map(({ task }) => task) : (task ? [task] : [])
    return { ...page, parentPageId: parentPage?.projectId === page.projectId ? page.parentPageId : null, linkedTasks }
  })
}

export async function searchPages({
  query,
  projectIds,
  userId,
  agentId,
  standalonePagesEnabled = true,
}: {
  query: string
  projectIds: number[]
  userId?: number
  agentId?: string | null
  standalonePagesEnabled?: boolean
}) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery || projectIds.length === 0) return []

  const pages = await prisma.page.findMany({
    where: {
      archived: false,
      ...(standalonePagesEnabled ? {} : { taskId: { not: null } }),
      projectId: { in: projectIds },
      project: { status: 'Normal', ...(userId === undefined ? {} : getProjectWhere(userId, agentId)) },
      OR: [
        { title: { contains: normalizedQuery, mode: 'insensitive' } },
        { contentText: { contains: normalizedQuery, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      publicId: true,
      title: true,
      contentText: true,
      projectId: true,
      task: {
        where: {
          status: { not: 'Deleted' },
          project: { status: 'Normal', ...(userId === undefined
            ? { id: { in: projectIds } }
            : getProjectWhere(userId, agentId)) },
        },
        select: { id: true },
      },
      parentPageId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  })
  return pages.map(({ task, ...page }) => ({ ...page, taskId: task?.id ?? null }))
}

export async function listPageVersions({ pageId }: { pageId: number }) {
  return prisma.docVersion.findMany({
    where: {
      entityType: 'page',
      entityId: pageId,
    },
    orderBy: [
      { version: 'desc' },
      { createdAt: 'desc' },
    ],
  })
}

export async function restorePageVersion({
  pageId,
  versionId,
  userId,
  agentId,
}: {
  pageId: number
  versionId: number
  userId: number
  agentId?: string | null
}) {
  const page = await prisma.$transaction(async (tx) => {
    const [current, version] = await Promise.all([
      tx.page.findUnique({ where: { id: pageId } }),
      tx.docVersion.findFirst({
        where: {
          id: versionId,
          entityType: 'page',
          entityId: pageId,
        },
      }),
    ])

    if (!current) throw new Error(`Page with ID ${pageId} not found`)
    if (!version) {
      throw new Error(`Page version with ID ${versionId} not found for page ${pageId}`)
    }

    await createPageSnapshot(tx, current, {
      userId,
      agentId,
      note: `Restored from page version ${version.version}`,
    })

    return tx.page.update({
      where: { id: pageId },
      data: {
        title: version.title ?? current.title,
        contentHtml: version.contentHtml,
        contentText: version.contentText,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })
  })

  queuePageUpsert(page.id)
  return page
}

export async function archivePage({
  id,
  userId,
  agentId,
}: {
  id: number
  userId: number
  agentId?: string | null
}) {
  const page = await prisma.$transaction(async (tx) => {
    const current = await tx.page.findUnique({ where: { id } })
    if (!current) throw new Error(`Page with ID ${id} not found`)
    if (current.archived) return current

    await createPageSnapshot(tx, current, {
      userId,
      agentId,
      note: 'Archived page',
    })

    return tx.page.update({
      where: { id },
      data: {
        archived: true,
        updatedAt: new Date(),
      },
    })
  })

  queuePageDelete(page.id)
  return page
}
