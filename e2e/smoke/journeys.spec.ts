import { test, expect } from '@playwright/test'
import { withRealtime } from './lib/realtime'
import { watchForLoops, assertColumnsStayVisible, assertNoLoop } from './lib/loopGuard'
import { readQaRunnerBoard } from './lib/readBoard'
import { createTask, deleteTask, fetchBootstrapWithTeams } from './lib/api'
import { QA_TASK_PREFIX } from './lib/boardSetup'
import { tieredId, readExpectedPlanLabel, readTier } from './lib/tier'


const LOGIN_PATH = '/login'
const createdTaskIds: number[] = []

function idTag(name: string) {
  return `@id:${tieredId(name)}`
}

test.beforeEach(() => {
  test.skip(process.env.HT_QA_JOURNEYS !== '1', 'HT_QA_JOURNEYS not set, write journeys are opt-in')
  createdTaskIds.length = 0
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
  await page.goto(withRealtime(`/detail/project-${board.projectId}/${created.uniqueIndex}`), { waitUntil: 'load' })
  await expect(page.locator('#title-input'), 'task detail title input did not render').toBeVisible({ timeout: 10_000 })
  assertNoLoop(guard, 'open task')
  guard.stop()
})

test(`switch boards`, { tag: [idTag('switch-boards')] }, async ({ page, request }) => {
  const board = requireBoard()
  const { teams } = await fetchBootstrapWithTeams(request)
  const other = teams.flatMap((t) => t.projects).find((p) => p.id !== board.projectId)
  test.skip(!other, 'account has no other board to switch to besides "QA runner board"')

  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  await assertColumnsStayVisible(page, '.kanban-column-title', 3_000)

  const guard = watchForLoops(page)
  await page.keyboard.press('Control+B')
  await page.locator(`#project-${other!.id}:visible`).first().click()
  await expect(page).toHaveURL(new RegExp(`[?&]id=${other!.id}(?:&|$)`))
  await assertColumnsStayVisible(page, '.kanban-column-title', 10_000)
  expect(guard.loads, 'switch boards performed a full page reload').toBe(0)
  assertNoLoop(guard, 'switch boards')
  guard.stop()
})

test(`create task`, { tag: [idTag('create-task'), '@mobile'] }, async ({ page }) => {
  const board = requireBoard()
  const title = `${QA_TASK_PREFIX} create-task journey ${Date.now()}`

  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  await page.locator('.kanban-column-title').first().waitFor({ state: 'visible' })

  const createResponse = page.waitForResponse(
    (res) => /\/api\/tasks\/(create|createGlobally)/.test(res.url()) && res.request().method() === 'POST',
    { timeout: 15_000 },
  )
  const modalTitleInput = page.locator('#title-input-modal')
  const inlineInput = page.locator('textarea[placeholder*="task" i], input[placeholder*="task" i]').first()
  await expect(async () => {
    await page.locator('.create-new-task-button').first().click()
    await expect(modalTitleInput.or(inlineInput)).toBeVisible({ timeout: 2_000 })
  }, 'the + column button never opened a create-task form').toPass({ timeout: 15_000 })

  if (await modalTitleInput.isVisible()) {
    await modalTitleInput.fill(title)
    const saveAndClose = page.locator('span', { hasText: /^Save & close/ }).first()
    const save = (await saveAndClose.isVisible()) ? saveAndClose : page.locator('span', { hasText: /^Save$/ }).first()
    await save.click()
  } else {
    await inlineInput.fill(title)
    await inlineInput.press('Enter')
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
      { message: 'created task did not appear after save', timeout: 10_000 },
    ).toBe(true)

    if (await taskDetailTitle.isVisible()) {
      await expect(taskDetailTitle, 'created task did not open after save').toHaveValue(title)
      await page.reload()
      await expect(taskDetailTitle, 'task did not persist after reload').toHaveValue(title, { timeout: 10_000 })
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

test(`ai chat replies`, { tag: [idTag('ai-chat')] }, async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto(withRealtime('/chat'), { waitUntil: 'load' })
  test.skip(page.url().includes(LOGIN_PATH), 'no chat access for this session')

  const prompt = 'In one short sentence, what is Hypertask?'
  const editor = page.locator('#ai-chat-tiptap-editor .ProseMirror')
  await editor.waitFor({ state: 'visible', timeout: 10_000 })
  await editor.click()
  await expect(editor, 'chat editor did not take focus').toBeFocused()
  await page.keyboard.type(prompt)
  await page.keyboard.press('Enter')

  const delivered = page.locator('.submessage-container.delivered .content-html')
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
