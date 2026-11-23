import { test, expect, type Page } from '@playwright/test'
import { withRealtime } from './lib/realtime'
import { watchForLoops, assertColumnsStayVisible, assertNoLoop } from './lib/loopGuard'
import { readQaRunnerBoard } from './lib/readBoard'
import { createTask, deleteTask, fetchBoardTasks, fetchBootstrapWithTeams } from './lib/api'
import { QA_TASK_PREFIX } from './lib/boardSetup'
import { tieredId, readExpectedPlanLabel, readTier } from './lib/tier'

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768

const LOGIN_PATH = '/login'
const createdTaskIds: number[] = []

function idTag(name: string) {
  return `@id:${tieredId(name)}`
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.HT_QA_JOURNEYS !== '1', 'HT_QA_JOURNEYS not set, write journeys are opt-in')
  createdTaskIds.length = 0
  if (isPhone(page)) await page.setViewportSize({ width: 390, height: 844 })
})

test.afterEach(async ({ request }) => {
  for (const id of createdTaskIds.splice(0)) {
    await deleteTask(request, id).catch((err) => {
      console.warn(`[journeys] cleanup could not delete task ${id}: ${err instanceof Error ? err.message : err}`)
    })
  }
})

function requireBoard() {
  const board = readQaRunnerBoard()
  test.skip(!board, 'QA runner board was not resolved by journeys.setup.ts')
  return board!
}

test(`login lands in app`, { tag: [idTag('login')] }, async ({ page }) => {
  const response = await page.goto(withRealtime('/inbox'), { waitUntil: 'load' })
  expect(response?.status(), 'login check got a non-2xx response').toBeLessThan(400)
  expect(page.url(), 'login check redirected to /login, session invalid').not.toContain(LOGIN_PATH)
})

test(`open board`, { tag: [idTag('open-board'), '@mobile'] }, async ({ page }) => {
  const board = requireBoard()
  const guard = watchForLoops(page)
  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  await assertColumnsStayVisible(page, '.kanban-column-title', 10_000)
  assertNoLoop(guard, 'open board')
  guard.stop()
})

test(`open task`, { tag: [idTag('open-task'), '@mobile'] }, async ({ page, request }) => {
  const board = requireBoard()
  const created = await createTask(request, {
    title: `${QA_TASK_PREFIX} open-task journey ${Date.now()}`,
    projectId: board.projectId,
    userId: board.userId,
  })
  createdTaskIds.push(created.id)

  const guard = watchForLoops(page)
  const detailPath = `/detail/project-${board.projectId}/${created.uniqueIndex}`
  if (isPhone(page)) {
    await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' }); await page.locator('.kanban-column-title').first().waitFor({ state: 'visible', timeout: 10_000 })
    const cardLink = page.locator(`#task-${created.id} a[href="${detailPath}"]`).first(); await expect(cardLink, `mobile task card ${created.id} did not become visible on the board`).toBeVisible({ timeout: 15_000 }); await cardLink.tap()
  } else await page.goto(withRealtime(detailPath), { waitUntil: 'load' })
  await expect(page.locator('#title-input'), 'task detail title input did not render').toBeVisible({ timeout: 10_000 })
  assertNoLoop(guard, 'open task')
  guard.stop()
})

test(`switch boards`, { tag: [idTag('switch-boards'), '@mobile'] }, async ({ page, request }) => {
  const board = requireBoard()
  const { teams } = await fetchBootstrapWithTeams(request)
  const other = teams.flatMap((t) => t.projects).find((p) => p.id !== board.projectId)
  test.skip(!other, 'account has no other board to switch to besides "QA runner board"')

  const openBoard = async (projectId: number) => {
    if (isPhone(page)) { await page.getByRole('button', { name: 'Switch board', exact: true }).tap(); await page.locator(`#mobile-board-option-${projectId}`).tap(); await expect(page).toHaveURL(new RegExp(`[?&]id=${projectId}(?:&|$)`)); return }
    const entry = page.locator(`#project-${projectId}:visible`)
    if ((await entry.count()) === 0) {
      await page.keyboard.press('Control+b')
      await expect(entry.first()).toBeVisible({ timeout: 5_000 })
    }
    await entry.first().click({ timeout: 5_000 })
    await expect(page).toHaveURL(new RegExp(`[?&]id=${projectId}(?:&|$)`))
  }

  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  await assertColumnsStayVisible(page, '.kanban-column-title', 3_000, 20_000, board.projectId)

  const guard = watchForLoops(page)
  await openBoard(other!.id)
  await assertColumnsStayVisible(page, '.kanban-column-title', 10_000, 20_000, other!.id)
  await openBoard(board.projectId)
  await assertColumnsStayVisible(page, '.kanban-column-title', 10_000, 20_000, board.projectId)
  expect(guard.loads, 'switch boards performed a full page reload').toBe(0)
  assertNoLoop(guard, 'switch boards')
  guard.stop()
})

test(`create task`, { tag: [idTag('create-task'), '@mobile'] }, async ({ page }) => {
  const board = requireBoard()
  const title = `${QA_TASK_PREFIX} create-task journey ${Date.now()}`

  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  await page.locator('.kanban-column-title').first().waitFor({ state: 'visible' })

  const modalTitleInput = page.locator('#title-input-modal')
  const inlineInput = page.locator('#newTask textarea[aria-label="Title"]')
  let createResponse: ReturnType<typeof page.waitForResponse>
  if (isPhone(page)) {
    createResponse = page.waitForResponse(
      (res) => /\/api\/tasks\/(create|createGlobally)/.test(res.url()) && res.request().method() === 'POST',
      { timeout: 45_000 },
    )
    await page.getByRole('button', { name: 'Commands', exact: true }).tap(); await page.getByRole('tab', { name: 'New Task' }).tap()
    const writer = page.locator('[aria-label="Describe the task"]').first(); await writer.tap(); await writer.fill(title); await page.locator('[data-compose-task-writer] [aria-label="Create task"], [data-compose-task-writer] [aria-label="Send message"]').first().tap()
  } else {
    await expect(async () => {
      await page.locator('.create-new-task-button').first().click()
      await expect(modalTitleInput.or(inlineInput)).toBeVisible({ timeout: 2_000 })
    }, 'the + column button never opened a create-task form').toPass({ timeout: 15_000 })

    createResponse = page.waitForResponse(
      (res) => {
        const pathname = new URL(res.url()).pathname
        return res.request().method() === 'POST' && (pathname === '/api/tasks/create' || pathname === '/api/tasks/createGlobally')
      },
      { timeout: 15_000 },
    )
    if (await modalTitleInput.isVisible()) {
      await modalTitleInput.fill(title)
      const saveAndClose = page.locator('span', { hasText: /^Save & close/ }).first()
      const save = (await saveAndClose.isVisible()) ? saveAndClose : page.locator('span', { hasText: /^Save$/ }).first()
      await save.click()
    } else {
      await inlineInput.fill(title)
      await inlineInput.press('Enter')
    }
  }

  const response = await createResponse
  const body = await response.json()
  const createdId = (body.newTask?.newTask ?? body.newTask ?? body)?.id
  if (createdId) createdTaskIds.push(createdId)

  if ((page.viewportSize()?.width ?? 1280) < 768) {
    const taskDetailTitle = page.locator('#title-input')
    const boardCard = page.locator(`text=${title}`).first()
    await expect.poll(
      async () => (await taskDetailTitle.isVisible()) || (await boardCard.isVisible()),
      { message: 'created task did not appear after save', timeout: 25_000 },
    ).toBe(true)

    if (await taskDetailTitle.isVisible()) {
      const savedTitle = await taskDetailTitle.inputValue()
      expect(savedTitle.length, 'created task did not open after save').toBeGreaterThan(0)
      await page.reload()
      await expect(taskDetailTitle, 'task did not persist after reload').toHaveValue(savedTitle, { timeout: 10_000 })
      return
    }
  }

  await expect(page.locator(`text=${title}`).first(), 'created task card did not appear on the board').toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.locator(`text=${title}`).first(), 'task did not persist after reload').toBeVisible({ timeout: 10_000 })
})

test(`edit description`, { tag: [idTag('edit-description')] }, async ({ page, request }) => {
  const board = requireBoard()
  const created = await createTask(request, {
    title: `${QA_TASK_PREFIX} edit-description journey ${Date.now()}`,
    projectId: board.projectId,
    userId: board.userId,
  })
  createdTaskIds.push(created.id)

  await page.goto(withRealtime(`/detail/project-${board.projectId}/${created.uniqueIndex}`), { waitUntil: 'load' })
  await page.locator('#title-input').waitFor({ state: 'visible' })

  const marker = `qajourney${Date.now()}`

  await page.locator('#description-container').dblclick()
  const editor = page.locator('#description-input .ProseMirror[contenteditable="true"]')
  await editor.waitFor({ state: 'visible', timeout: 5_000 })
  await editor.click()
  await page.keyboard.type(`QA journey description ${marker} `)
  await page.keyboard.press('Control+b')
  await page.keyboard.type('bold-part')
  await page.keyboard.press('Control+b')
  await page.keyboard.press('Escape')

  await page.reload()
  const descriptionAfterReload = page.locator('#description-input .ProseMirror[contenteditable="false"]')
  await expect(descriptionAfterReload, 'description edit did not persist after reload').toContainText(marker, { timeout: 10_000 })
  await expect(
    descriptionAfterReload.locator('strong', { hasText: 'bold-part' }),
    'bold formatting did not persist, rich text was not actually saved as rich text',
  ).toBeVisible()
})

test(`add comment`, { tag: [idTag('add-comment')] }, async ({ page, request }) => {
  const board = requireBoard()
  const created = await createTask(request, {
    title: `${QA_TASK_PREFIX} add-comment journey ${Date.now()}`,
    projectId: board.projectId,
    userId: board.userId,
  })
  createdTaskIds.push(created.id)

  await page.goto(withRealtime(`/detail/project-${board.projectId}/${created.uniqueIndex}`), { waitUntil: 'load' })
  await page.locator('#title-input').waitFor({ state: 'visible' })

  const commentText = `QA journey comment ${Date.now()}, no mentions here.`
  await page.locator('#comment-input').click()
  const commentEditor = page.locator('#comment-input .ProseMirror[contenteditable="true"]')
  await commentEditor.waitFor({ state: 'visible', timeout: 5_000 })
  await commentEditor.click()
  await page.keyboard.type(commentText)
  const commentSaved = page.waitForResponse(
    (res) => res.url().includes('/api/comments/create') && res.request().method() === 'POST',
    { timeout: 15_000 },
  )
  await page.keyboard.press('Control+Enter')
  expect((await commentSaved).ok(), 'comment create request failed').toBe(true)

  const postedOutsideEditor = () =>
    page.locator(`text=${commentText}`).evaluateAll((els) => els.filter((el) => !el.closest('#comment-input')).length)
  await expect.poll(postedOutsideEditor, { message: 'comment did not appear', timeout: 10_000 }).toBeGreaterThan(0)
  await page.reload()
  await page.locator('#title-input').waitFor({ state: 'visible' })
  await expect.poll(postedOutsideEditor, { message: 'comment did not persist after reload', timeout: 10_000 }).toBeGreaterThan(0)
})

test(`drag card between columns`, { tag: [idTag('drag-card')] }, async ({ page, request }) => {
  const board = requireBoard()
  const created = await createTask(request, {
    title: `${QA_TASK_PREFIX} drag-card journey ${Date.now()}`,
    projectId: board.projectId,
    userId: board.userId,
  })
  createdTaskIds.push(created.id)

  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  const columns = page.locator('.kanban-column-title')
  await columns.first().waitFor({ state: 'visible' })
  const columnCount = await columns.count()
  test.skip(columnCount < 2, 'board has fewer than 2 columns, nothing to drag between')

  const card = page.locator(`[data-rfd-drag-handle-draggable-id="task-${created.id}"]`)
  await card.waitFor({ state: 'visible', timeout: 10_000 })

  const targetColumn = page.locator('[data-rfd-droppable-id="1"]')
  await targetColumn.waitFor({ state: 'visible' })

  await expect(
    targetColumn.locator(`[data-rfd-drag-handle-draggable-id="task-${created.id}"]`),
    'test setup bug: the new card is already in the drag target column',
  ).toHaveCount(0)

  const cardBox = await card.boundingBox()
  const targetBox = await targetColumn.boundingBox()
  if (!cardBox || !targetBox) throw new Error('could not measure drag source/target bounding boxes')

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    const x = cardBox.x + ((targetBox.x - cardBox.x) * i) / steps
    const y = cardBox.y + ((targetBox.y - cardBox.y) * i) / steps
    await page.mouse.move(x, y)
    await page.waitForTimeout(50)
  }
  await page.mouse.up()

  await page.waitForTimeout(500)
  await page.reload()
  await expect(
    page.locator('[data-rfd-droppable-id="1"]').locator(`[data-rfd-drag-handle-draggable-id="task-${created.id}"]`),
    'card did not stay in the target column after reload',
  ).toBeVisible({ timeout: 10_000 })
})

test(`reply in inbox`, { tag: [idTag('reply-inbox'), '@mobile'] }, async ({ page, request }) => {
  const board = requireBoard(), title = `${QA_TASK_PREFIX} reply-inbox journey ${Date.now()}`, replyText = `QA inbox reply ${Date.now()}`
  const created = await createTask(request, { title, projectId: board.projectId, userId: board.userId }); createdTaskIds.push(created.id)
  expect((await request.post('/api/notifications/moveTaskToInbox', { data: { taskId: created.id, projectId: board.projectId } })).ok()).toBe(true)
  await page.goto(withRealtime('/inbox'), { waitUntil: 'load' })
  const row = page.getByText(title).first(); await expect(row).toBeVisible({ timeout: 15_000 }); await (isPhone(page) ? row.tap() : row.click()); await expect(page.locator('#title-input')).toBeVisible({ timeout: 15_000 })
  const editor = page.locator('[data-testid="comment-composer"] .ProseMirror[contenteditable="true"], #comment-input .ProseMirror[contenteditable="true"]').first()
  if (!(await editor.isVisible())) await (isPhone(page) ? page.locator('#comment-input, #comment-input-input').first().tap() : page.locator('#comment-input').click())
  await (isPhone(page) ? editor.tap() : editor.click()); await page.keyboard.insertText(replyText)
  const saved = page.waitForResponse((res) => res.url().includes('/api/comments/create') && res.request().method() === 'POST', { timeout: 15_000 })
  if (isPhone(page)) await page.getByRole('button', { name: 'Send comment' }).tap(); else await page.keyboard.press('Control+Enter')
  expect((await saved).ok(), 'inbox reply create failed').toBe(true)
  await page.goto(withRealtime(`/detail/project-${board.projectId}/${created.uniqueIndex}`), { waitUntil: 'load' }); await expect(page.getByText(replyText).first(), 'inbox reply did not persist after reload').toBeVisible({ timeout: 10_000 })
  await request.post('/api/notifications/markAsDone', { data: { taskId: created.id, userId: board.userId } }).catch(() => {})
})

test(`switch column`, { tag: [idTag('switch-column'), '@mobile'] }, async ({ page, request }) => {
  const board = requireBoard(), { project } = await fetchBoardTasks(request, board.projectId), sections = project.section ?? []; test.skip(sections.length < 2, 'board has fewer than 2 columns')
  const created = await createTask(request, { title: `${QA_TASK_PREFIX} switch-column journey ${Date.now()}`, projectId: board.projectId, userId: board.userId }); createdTaskIds.push(created.id)
  await page.goto(withRealtime(`/detail/project-${board.projectId}/${created.uniqueIndex}`), { waitUntil: 'load' }); await expect(page.locator('#title-input')).toBeVisible({ timeout: 10_000 })
  const rail = page.locator('[data-task-properties-rail]').first(), targetTitle = sections[1].section_title, moved = page.waitForResponse((res) => /\/api\/tasks\/moveTask/.test(res.url()) && res.request().method() === 'PUT', { timeout: 15_000 })
  const trigger = rail.getByText(sections[0].section_title, { exact: true }).first(); await (isPhone(page) ? trigger.tap() : trigger.click())
  const option = page.getByText(targetTitle, { exact: true }).last(); await (isPhone(page) ? option.tap() : option.click())
  expect((await moved).ok(), 'column move request failed').toBe(true); await page.reload(); await expect(rail.getByText(targetTitle, { exact: true }).first(), 'column change did not persist after reload').toBeVisible({ timeout: 10_000 })
})

test(`ai chat replies`, { tag: [idTag('ai-chat'), '@mobile'] }, async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto(withRealtime('/chat'), { waitUntil: 'load' })
  test.skip(page.url().includes(LOGIN_PATH), 'no chat access for this session')

  const prompt = 'In one short sentence, what is Hypertask?'
  const editor = page.locator('#ai-chat-tiptap-editor .ProseMirror')
  await editor.waitFor({ state: 'visible', timeout: 10_000 })
  await (isPhone(page) ? editor.tap() : editor.click())
  await expect(editor, 'chat editor did not take focus').toBeFocused()
  await page.keyboard.type(prompt)
  if (isPhone(page)) await page.getByRole('button', { name: /^Send(?: message)?$/ }).last().tap()
  else await page.keyboard.press('Enter')

  const delivered = page.locator('.submessage-container.delivered [data-chat-content-html]')
  await expect(delivered, 'no AI reply arrived within the timeout').toHaveCount(2, { timeout: 45_000 })
  const text = (await delivered.last().innerText()).trim()
  expect(text.length, 'AI reply was empty').toBeGreaterThan(0)
  expect(text, 'last message is the prompt, not an AI reply').not.toBe(prompt)
})

test(`plan shows correctly`, { tag: [idTag('plan-check')] }, async ({ page }) => {
  const expected = readExpectedPlanLabel()
  test.skip(
    !expected,
    `no expected plan for tier "${readTier() ?? '(none)'}" (known tiers: free, byok, pro)`,
  )

  await page.goto(withRealtime('/settings/billing'), { waitUntil: 'load' })
  const planLabel = page.locator('span', { hasText: /^Plan$/ }).first()
  const planValue = planLabel.locator('xpath=following-sibling::span[1]')
  await expect(planValue, `plan row did not show "${expected}"`).toHaveText(expected!, { timeout: 10_000 })
})
