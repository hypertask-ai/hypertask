import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import {
  convertToPlain,
  deletePageFromTurbopuffer,
  upsertPageToTurbopuffer,
} from '@/utils/controllers/turbopuffer/turbopufferHelper'
import { markdownToHtml } from '@/utils/helperFunctions/markdownToHtml'
import { sanitizeRichHtml } from '@/utils/helperFunctions/sanitizeRichHtml'
import { extractCanvasText, wrapHtmlCanvas } from './htmlCanvas'

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
  // Canvas: wrap the raw agent HTML into one opaque block (rendered only inside
  // the sandboxed iframe) and index its stripped text for RAG/search.
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
  title,
  content,
  contentType,
  parentPageId,
  userId,
  agentId,
}: {
  taskId: number
  title?: string
  content: string
  contentType: PageContentType
  parentPageId?: number | null
  userId: number
  agentId?: string | null
}) {
  const rendered = renderPageContent({ content, contentType })

  const page = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    })
    if (!task) throw new Error(`Task with ID ${taskId} not found`)

    if (parentPageId != null) {
      const parentPage = await tx.page.findFirst({
        where: { id: parentPageId, taskId },
        select: { id: true },
      })
      if (!parentPage) {
        throw new Error(`Parent page with ID ${parentPageId} not found in task ${taskId}`)
      }
    }

    // No snapshot on create: the Page row itself is version 1 (the current
    // state). DocVersion only records *past* versions, written on each mutation.
    return tx.page.create({
      data: {
        ...(title === undefined ? {} : { title }),
        contentHtml: rendered.html,
        contentText: rendered.text,
        taskId,
        parentPageId: parentPageId ?? null,
        projectId: task.projectId,
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

export async function getPage(args: GetPageArgs) {
  const where = 'id' in args
    ? { id: args.id }
    : { publicId: args.publicId }

  return prisma.page.findUnique({
    where,
    include: {
      task: true,
      subPages: {
        select: {
          id: true,
          title: true,
          publicId: true,
        },
      },
    },
  })
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
          contentType: contentType ?? 'markdown',
          mode,
        })

    await createPageSnapshot(tx, current, { userId, agentId, note })

    // Optimistic lock: guard the write on the version we read. If a concurrent
    // writer bumped it between our read and here, count === 0 -> conflict, so
    // two racing updates can never silently clobber each other's content.
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
}: {
  taskId?: number
  projectId?: number
}) {
  return prisma.page.findMany({
    where: {
      archived: false,
      ...(taskId === undefined ? {} : { taskId }),
      ...(projectId === undefined ? {} : { projectId }),
    },
    select: {
      id: true,
      publicId: true,
      title: true,
      parentPageId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function searchPages({
  query,
  projectIds,
}: {
  query: string
  projectIds: number[]
}) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery || projectIds.length === 0) return []

  return prisma.page.findMany({
    where: {
      archived: false,
      projectId: { in: projectIds },
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
      taskId: true,
      projectId: true,
      parentPageId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  })
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
