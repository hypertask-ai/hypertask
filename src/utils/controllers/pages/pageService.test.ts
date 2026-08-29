// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/utils/controllers/pages/pageService.test.ts
import assert from 'node:assert/strict'

async function demo() {
  process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused'

  const [{ default: prisma }, pageService] = await Promise.all([
    import('@/lib/prisma'),
    import('./pageService'),
  ])
  const { PageConflictError, renderPageContent, updatePage } = pageService

  const rendered = renderPageContent({
    content: '# Hello\n\n**world**\n\n[bad](javascript:alert(1))',
    contentType: 'markdown',
  })
  assert.match(rendered.html, /<h1>Hello<\/h1>/)
  assert.match(rendered.html, /<strong>world<\/strong>/)
  assert.ok(!rendered.html.includes('javascript:'), 'unsafe markdown URL is removed')
  assert.equal(rendered.text.replace(/\s+/g, ' ').trim(), 'Hello world bad')

  const currentPage = {
    id: 1,
    publicId: 'page-1',
    title: 'Test page',
    contentHtml: '<p>old</p>',
    contentText: 'old',
    taskId: 10,
    parentPageId: null,
    projectId: 20,
    version: 1,
    createdById: 30,
    agentId: null,
    archived: false,
    createdAt: new Date('2026-07-21T00:00:00.000Z'),
    updatedAt: new Date('2026-07-21T00:00:00.000Z'),
  }
  const snapshots: unknown[] = []

  const tx = {
    page: {
      findUnique: async () => ({ ...currentPage }),
      update: async ({ data }: { data: Record<string, any> }) => {
        currentPage.contentHtml = data.contentHtml
        currentPage.contentText = data.contentText
        if (data.title !== undefined) currentPage.title = data.title
        currentPage.version += data.version.increment
        currentPage.updatedAt = data.updatedAt
        return { ...currentPage }
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, any>
        data: Record<string, any>
      }) => {
        if (where.version !== undefined && where.version !== currentPage.version) {
          return { count: 0 }
        }
        if (data.contentHtml !== undefined) currentPage.contentHtml = data.contentHtml
        if (data.contentText !== undefined) currentPage.contentText = data.contentText
        if (data.title !== undefined) currentPage.title = data.title
        currentPage.version += data.version.increment
        currentPage.updatedAt = data.updatedAt
        return { count: 1 }
      },
    },
    docVersion: {
      create: async ({ data }: { data: unknown }) => {
        snapshots.push(data)
        return data
      },
    },
  }

  const prismaMock = prisma as any
  const originalTransaction = prismaMock.$transaction
  const originalPageFindFirst = prismaMock.page.findFirst
  prismaMock.$transaction = async (callback: (transaction: typeof tx) => unknown) => callback(tx)
  // Prevent the fire-and-forget indexer from reaching Prisma or Turbopuffer.
  prismaMock.page.findFirst = async () => null

  try {
    const appended = await updatePage({
      id: 1,
      content: '<p>after</p>',
      contentType: 'html',
      mode: 'append',
      ifVersion: 1,
      userId: 30,
    })
    assert.equal(appended.contentHtml, '<p>old</p><p>after</p>')
    assert.equal(appended.contentText, 'oldafter')

    const prepended = await updatePage({
      id: 1,
      content: '<p>before</p>',
      contentType: 'html',
      mode: 'prepend',
      ifVersion: 2,
      userId: 30,
    })
    assert.equal(prepended.contentHtml, '<p>before</p><p>old</p><p>after</p>')
    assert.equal(prepended.contentText, 'beforeoldafter')

    const replaced = await updatePage({
      id: 1,
      content: '<p>replacement</p>',
      contentType: 'html',
      mode: 'replace',
      ifVersion: 3,
      userId: 30,
    })
    assert.equal(replaced.contentHtml, '<p>replacement</p>')
    assert.equal(replaced.contentText, 'replacement')
    assert.equal(snapshots.length, 3)

    const renamed = await updatePage({
      id: 1,
      title: 'Renamed page',
      ifVersion: 4,
      userId: 30,
    })
    assert.equal(renamed.title, 'Renamed page')
    assert.equal(renamed.contentHtml, '<p>replacement</p>')
    assert.equal(renamed.version, 5)
    assert.equal((snapshots[3] as { title: string }).title, 'Test page')

    await assert.rejects(
      updatePage({
        id: 1,
        content: '<p>stale</p>',
        contentType: 'html',
        mode: 'replace',
        ifVersion: 4,
        userId: 30,
      }),
      (error: unknown) => {
        assert.ok(error instanceof PageConflictError)
        assert.equal(error.currentVersion, 5)
        assert.deepEqual(error.currentContent, {
          html: '<p>replacement</p>',
          text: 'replacement',
        })
        return true
      }
    )
    assert.equal(snapshots.length, 4, 'conflicts do not create snapshots')

    await new Promise<void>((resolve) => setImmediate(resolve))
  } finally {
    prismaMock.$transaction = originalTransaction
    prismaMock.page.findFirst = originalPageFindFirst
  }
}

void demo().then(() => {
  console.log('pageService.test.ts: all assertions passed')
})
