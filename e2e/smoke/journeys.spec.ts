import { test, expect } from '@playwright/test'
import { withRealtime } from './lib/realtime'
import { watchForLoops, assertColumnsStayVisible, assertNoLoop } from './lib/loopGuard'
import { readQaRunnerBoard } from './lib/readBoard'
import { createTask, deleteTask, fetchBootstrap } from './lib/api'
import { QA_TASK_PREFIX } from './lib/boardSetup'
import { tieredId, readExpectedPlanLabel, readTier } from './lib/tier'

// HTPR-6636 phase 2, customer journeys that create/edit/delete real data,
// approved ONLY on the private "QA runner board" (see boardSetup.ts). Gated
// behind HT_QA_JOURNEYS=1 so prod-health.yml (which shares this same
// playwright.config.smoke.ts) never runs them, that job only ever wants
// the original 8 read-only view checks.
//
// Every test here is independent: it creates whatever task it needs and
// deletes it in its own afterEach, so a failed run leaves nothing behind
// beyond what journeys.setup.ts's 1-hour sweep would catch anyway.
//
// Every test carries an `@id:<name>` tag, the stable id
// lib/process-report.mjs in hypertask-qa-runner dedups tickets on (via
// spec.tags, not spec.title, which changes with the tier prefix).

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
    sectionId: board.sectionId,
    sectionTitle: board.sectionTitle,
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
  const bootstrap = await fetchBootstrap(request)
  const teams = bootstrap.slices.teams?.ok ? bootstrap.slices.teams.data : []
  const other = teams.flatMap((t) => t.projects).find((p) => p.id !== board.projectId)
  test.skip(!other, 'account has no other board to switch to besides "QA runner board"')

  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  await assertColumnsStayVisible(page, '.kanban-column-title', 3_000)

  const guard = watchForLoops(page)
  await page.goto(withRealtime(`/detail/project-${other!.id}`), { waitUntil: 'load' })
  await assertColumnsStayVisible(page, '.kanban-column-title', 10_000)
  assertNoLoop(guard, 'switch boards')
  guard.stop()
})

test(`create task`, { tag: [idTag('create-task'), '@mobile'] }, async ({ page }) => {
  const board = requireBoard()
  const title = `${QA_TASK_PREFIX} create-task journey ${Date.now()}`

  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  await page.locator('.kanban-column-title').first().waitFor({ state: 'visible' })

  // The "+" column control opens either the full create-task modal or an
  // inline quick-entry textarea, depending on the htpr-6175-quick-entry-cards
  // flag (src/hooks/Homepage/useSections.ts), handle both. Either way,
  // wait for the actual create response instead of scraping a card's href,
  // so cleanup always has the real database id (not a ticket number, and
  // never silently skipped by a `.catch(() => null)`).
  const createResponse = page.waitForResponse(
    (res) => /\/api\/tasks\/(create|createGlobally)/.test(res.url()) && res.request().method() === 'POST',
    { timeout: 15_000 },
  )
  await page.locator('.create-new-task-button').first().click()

  const modalTitleInput = page.locator('#title-input-modal')
  const inlineInput = page.locator('textarea[placeholder*="task" i], input[placeholder*="task" i]').first()

  if (await modalTitleInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await modalTitleInput.fill(title)
    await modalTitleInput.press('Enter')
  } else {
    await inlineInput.waitFor({ state: 'visible', timeout: 5_000 })
    await inlineInput.fill(title)
    await inlineInput.press('Enter')
  }

  const response = await createResponse
  const body = await response.json()
  const createdId = (body.newTask ?? body)?.id
  if (createdId) createdTaskIds.push(createdId)

  await expect(page.locator(`text=${title}`).first(), 'created task card did not appear on the board').toBeVisible({ timeout: 10_000 })

  // Confirm persistence past this render, not just an optimistic UI update.
  await page.reload()
  await expect(page.locator(`text=${title}`).first(), 'task did not persist after reload').toBeVisible({ timeout: 10_000 })
})

test(`edit description`, { tag: [idTag('edit-description')] }, async ({ page, request }) => {
  const board = requireBoard()
  const created = await createTask(request, {
    title: `${QA_TASK_PREFIX} edit-description journey ${Date.now()}`,
    projectId: board.projectId,
    sectionId: board.sectionId,
    sectionTitle: board.sectionTitle,
  })
  createdTaskIds.push(created.id)

  await page.goto(withRealtime(`/detail/project-${board.projectId}/${created.uniqueIndex}`), { waitUntil: 'load' })
  await page.locator('#title-input').waitFor({ state: 'visible' })

  const marker = `qajourney${Date.now()}`

  // Read-mode description container; double-click enters edit mode
  // (DescriptonBody.tsx / TipTapTaskDetail.tsx, mode="read-edit-description").
  // Unverified against a live account, first real run confirms the selector.
  const descriptionArea = page.locator('#description, [id*="description" i]').first()
  await descriptionArea.dblclick()
  const editor = page.locator('.ProseMirror#description, #description .ProseMirror').first()
  await editor.waitFor({ state: 'visible', timeout: 5_000 })
  await editor.fill('')
  await editor.type(`QA journey description ${marker} `)
  // Actually exercise rich text (bold), not a literal "<strong>" string.
  await editor.type('bold-part')
  await editor.press('Control+a')
  await editor.press('Control+b')
  await editor.press('End')
  await editor.press('Escape') // commits the save (useSaveContent.ts handleEscape)

  await page.reload()
  const descriptionAfterReload = page.locator('#description, [id*="description" i]').first()
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
    sectionId: board.sectionId,
    sectionTitle: board.sectionTitle,
  })
  createdTaskIds.push(created.id)

  await page.goto(withRealtime(`/detail/project-${board.projectId}/${created.uniqueIndex}`), { waitUntil: 'load' })
  await page.locator('#title-input').waitFor({ state: 'visible' })

  // No "@" (Tiptap opens a real mention picker on "@", Enter after typing
  // one could tag an actual person, which the owner explicitly ruled out)
  // and no em dash (repo style).
  const commentText = `QA journey comment ${Date.now()}, no mentions here.`
  await page.locator('#comment-input').click()
  const commentEditor = page.locator('#comment')
  await commentEditor.waitFor({ state: 'visible', timeout: 5_000 })
  await commentEditor.type(commentText)
  await commentEditor.press('Enter')

  await expect(page.locator(`text=${commentText}`), 'comment did not appear').toBeVisible({ timeout: 10_000 })
  await page.reload()
  await expect(page.locator(`text=${commentText}`), 'comment did not persist after reload').toBeVisible({ timeout: 10_000 })
})

test(`drag card between columns`, { tag: [idTag('drag-card')] }, async ({ page, request }) => {
  const board = requireBoard()
  const created = await createTask(request, {
    title: `${QA_TASK_PREFIX} drag-card journey ${Date.now()}`,
    projectId: board.projectId,
    sectionId: board.sectionId,
    sectionTitle: board.sectionTitle,
  })
  createdTaskIds.push(created.id)

  await page.goto(withRealtime(board.boardPath), { waitUntil: 'load' })
  const columns = page.locator('.kanban-column-title')
  await columns.first().waitFor({ state: 'visible' })
  const columnCount = await columns.count()
  test.skip(columnCount < 2, 'board has fewer than 2 columns, nothing to drag between')

  const card = page.locator(`[data-rbd-drag-handle-draggable-id="task-${created.id}"]`)
  await card.waitFor({ state: 'visible', timeout: 10_000 })

  const droppables = page.locator('[data-rbd-droppable-id]')
  const targetColumn = droppables.nth(1)
  await targetColumn.waitFor({ state: 'visible' })

  // Sanity: the task was just created in section 0 (the board's first
  // section), so it must NOT already be in the target column, otherwise
  // a no-op drag would pass this test for the wrong reason.
  await expect(
    targetColumn.locator(`[data-rbd-drag-handle-draggable-id="task-${created.id}"]`),
    'test setup bug: the new card is already in the drag target column',
  ).toHaveCount(0)

  // @hello-pangea/dnd reads incremental mousemove deltas, not a single jump ,
  // Playwright's dragTo() alone typically won't register with it.
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

  await page.waitForTimeout(500) // let onDragEnd's PUT /api/tasks/moveTask land
  await page.reload()
  await expect(
    page.locator('[data-rbd-droppable-id]').nth(1).locator(`[data-rbd-drag-handle-draggable-id="task-${created.id}"]`),
    'card did not stay in the target column after reload',
  ).toBeVisible({ timeout: 10_000 })
})

test(`ai chat replies`, { tag: [idTag('ai-chat')] }, async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto(withRealtime('/chat'), { waitUntil: 'load' })
  test.skip(page.url().includes(LOGIN_PATH), 'no chat access for this session')

  const editor = page.locator('#ai-chat-tiptap-editor')
  await editor.waitFor({ state: 'visible', timeout: 10_000 })
  await editor.click()
  await editor.type('In one short sentence, what is Hypertask?')
  await editor.press('Enter')

  const reply = page.locator('.submessage-container.delivered .content-html').last()
  await expect(reply, 'no non-empty AI reply within the timeout').toBeVisible({ timeout: 45_000 })
  const text = (await reply.innerText()).trim()
  expect(text.length, 'AI reply was empty').toBeGreaterThan(0)
})

test(`plan shows correctly`, { tag: [idTag('plan-check')] }, async ({ page }) => {
  const expected = readExpectedPlanLabel()
  test.skip(
    !expected,
    `HT_QA_EXPECTED_PLAN not set for tier "${readTier() ?? '(none)'}", the free/light/premium-to-plan mapping ` +
      'is not confirmed yet, see the PR description\'s open questions',
  )

  await page.goto(withRealtime('/settings/billing'), { waitUntil: 'load' })
  // BillingSection.tsx's "Plan" row renders as two adjacent spans ("Plan",
  // then the value) inside one row div, not "Plan" as its own paragraph ,
  // match the label span, then read its sibling.
  const planLabel = page.locator('span', { hasText: /^Plan$/ }).first()
  const planValue = planLabel.locator('xpath=following-sibling::span[1]')
  await expect(planValue, `plan row did not show "${expected}"`).toHaveText(expected!, { timeout: 10_000 })
})
