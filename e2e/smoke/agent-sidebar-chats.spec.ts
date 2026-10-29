import { test, expect, type Page, type Locator, type APIRequestContext, type Response } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withRealtime } from './lib/realtime'
import { waitForTicketInitialScroll } from './lib/layout-lock-scroll'

const FLAG = 'htpr-7518-agent-sidebar-chats'
const PAST_CHATS_FLAG = 'htpr-7688-past-chats-first'
const stateFile = process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'
const readFixture = (): Fixture => JSON.parse(readFileSync(path.join(path.dirname(stateFile), 'agent-sidebar-fixture.json'), 'utf8'))
test.use({ storageState: async ({}, applyState, info) => {
  await applyState(readFixture().storageStates[info.project.name])
} })
test.describe.configure({ mode: 'serial' })
test.skip(!process.env.BROWSER_SMOKE_PR, 'Writes only to GitHub disposable loopback fixtures')

type Agent = { id: string; name: string; sessionId: string; token: string }
type PersonalChat = { lane: string; id: string; title: string; updatedAt: string; message: string }
type Fixture = { projectId: number; lanes: Record<string, Agent[]>; personalChats: PersonalChat[]; storageStates: Record<string, string> }
let fixture: Fixture

test.beforeAll(() => {
  expect(['127.0.0.1', 'localhost']).toContain(new URL(process.env.BASE_URL!).hostname)
  fixture = readFixture()
})

test.beforeEach(async ({ page }) => {
  page.on('request', async (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/agent-sidebar-chats' || url.pathname.startsWith('/api/agent-chat/')) {
      const headers = await request.allHeaders()
      console.log(`[sidebar request] ${request.method()} ${url.pathname}${url.search} project=${headers['x-hypertask-sidebar-project'] ?? 'none'} urlOrigin=${url.origin} origin=${headers.origin ?? 'none'} host=${headers.host ?? 'none'}`)
    }
  })
  page.on('response', async (response) => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/api/') && response.status() >= 500) {
      console.log(`[sidebar apierror] ${response.request().method()} ${url.pathname} status=${response.status()}`)
    }
    if (url.pathname !== '/api/agent-sidebar-chats' && !url.pathname.startsWith('/api/agent-chat/') && url.pathname !== '/api/flags') return
    const body = await response.json().catch(() => null)
    console.log(`[sidebar response] ${response.request().method()} ${url.pathname} status=${response.status()} ${JSON.stringify({
      success: body?.success, error: body?.error, sessionId: body?.session?.id,
      sidebarFlag: body?.flags?.[FLAG], agents: body?.agents?.map((agent: { id: string; sessionId: string }) => ({ id: agent.id, sessionId: agent.sessionId })),
      messages: body?.messages?.length,
    })}`)
  })
  page.on('pageerror', (error) => console.log(`[sidebar pageerror] ${error.message}`))
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/agent')) console.log(`[sidebar requestfailed] ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText}`)
  })
})

async function heartbeat(request: APIRequestContext, agent: Agent) {
  let sequence = Date.now()
  let response = await request.post('/api/mcp/agents/runtime-heartbeat', {
    headers: { Authorization: `Bearer ${agent.token}` }, data: { sequence, runtime: 'smoke-fixture', queue: [] },
  })
  if (response.status() === 409) {
    sequence = (await response.json()).reset_sequence
    response = await request.post('/api/mcp/agents/runtime-heartbeat', {
      headers: { Authorization: `Bearer ${agent.token}` }, data: { sequence, runtime: 'smoke-fixture', queue: [] },
    })
  }
  expect(response.status()).toBe(200)
}

async function open(page: Page, lane: string) {
  const flags = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/flags' && response.ok())
  const activity = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/activity/addLastActiveAt')
  await page.goto(withRealtime(`/project?id=${fixture.projectId}&surface=board&agentSidebar=1`))
  expect((await activity).status(), 'sidebar board startup records user activity').toBe(200)
  await expect(page.getByTestId('ai-sidebar')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch conversation', exact: true })).toBeVisible()
  const enabledFlags = (await (await flags).json()).flags
  expect(enabledFlags[FLAG], 'server sidebar flag in disposable fixture').toBe(true)
  expect(enabledFlags[PAST_CHATS_FLAG], 'past chats flag in disposable fixture').toBe(true)
  await expect(page.getByTestId('agent-sidebar-conversations')).toBeVisible()
  await choose(page, fixture.personalChats.find(chat => chat.lane === lane)!.title)
  return enabledFlags
}
async function settledBox(locator: ReturnType<Page['locator']>) {
  let previous = await locator.boundingBox()
  await expect.poll(async () => {
    const next = await locator.boundingBox()
    const unchanged = next !== null && JSON.stringify(next) === JSON.stringify(previous)
    previous = next
    return unchanged
  }, { intervals: [150] }).toBe(true)
  return previous!
}
async function dismissConversationsOutside(page: Page) {
  const sidebar = page.getByTestId('ai-sidebar')
  const list = page.getByTestId('agent-sidebar-conversations')
  await expect(list).toBeVisible()
  const menu = (await list.boundingBox())!
  const panel = (await sidebar.boundingBox())!
  const viewport = page.viewportSize()!
  const left = Math.max(0, panel.x)
  const right = Math.min(viewport.width, panel.x + panel.width)
  const top = Math.max(0, panel.y, menu.y)
  const bottom = Math.min(viewport.height, panel.y + panel.height, menu.y + menu.height)
  const leftGap = menu.x - left
  const rightGap = right - menu.x - menu.width
  expect(Math.max(leftGap, rightGap) > 0, 'sidebar has an uncovered strip beside the list').toBe(true)
  expect(bottom > top, 'list overlaps the visible sidebar').toBe(true)
  const point = {
    x: leftGap > rightGap ? left + leftGap / 2 : right - rightGap / 2,
    y: (top + bottom) / 2,
  }
  expect(point.x < menu.x || point.x > menu.x + menu.width, 'outside point is not in the list').toBe(true)
  expect(await sidebar.evaluate((node, point) => {
    const target = document.elementFromPoint(point.x, point.y)
    return node.contains(target) && !target?.closest('#agent-sidebar-conversations, [aria-controls="agent-sidebar-conversations"]')
  }, point), 'outside point hits the sidebar, not the list or its trigger').toBe(true)
  await sidebar.click({ position: { x: point.x - panel.x, y: point.y - panel.y } })
  await expect(list).toBeHidden()
  await expect(sidebar).toBeVisible()
}
async function reveal(list: Locator, row: Locator) {
  const more = list.getByRole('option', { name: /^Show (\d+ )?more$/ })
  await expect.poll(async () => {
    if (await row.isVisible()) return true
    if (await more.isVisible()) await more.click()
    return false
  }, { timeout: 15_000 }).toBe(true)
}
async function choose(page: Page, name: string, error?: string, expectedTitle = name) {
  const list = page.getByTestId('agent-sidebar-conversations')
  if (!await list.isVisible()) await page.getByRole('button', { name: 'Switch conversation', exact: true }).click()
  const agent = Object.values(fixture.lanes).flat().find(agent => agent.name === name)
  const chat = fixture.personalChats.find(chat => chat.title === name)
  const key = agent?.id ?? (chat ? `session:${chat.id}` : 'ai')
  const row = list.locator(`[data-command-key="${key}"]`)
  await reveal(list, row)
  await row.click()
  await expect(list).toBeHidden()
  if (error) {
    await expect(page.getByText(error, { exact: true })).toBeVisible()
    return
  }
  await expect(page.getByRole('button', { name: 'Switch conversation', exact: true })).toHaveText(agent?.name ?? chat?.title ?? expectedTitle)
  if (agent) await expect(page.getByTestId('ai-sidebar').getByText(`${agent.name} history 1`, { exact: true })).toBeVisible()
  else if (chat) await expect(page.getByTestId('ai-sidebar').getByText(chat.message, { exact: true })).toBeVisible()
  await expect(agent && !agent.name.endsWith('Native')
    ? page.getByRole('textbox', { name: `Message ${agent.name}`, exact: true })
    : page.locator('[data-ai-chat-composer-root]:not([inert]) #ai-chat-tiptap-editor .ProseMirror:visible')).toBeVisible()
}

test('phone conversation list leaves the composer clear and typing taps never switch chats', async ({ page }, info) => {
  test.skip(info.project.name !== 'Mobile', 'Phone composer clearance')
  await page.setViewportSize({ width: 390, height: 664 })
  await open(page, info.project.name)
  const sidebar = page.getByTestId('ai-sidebar')
  const title = page.getByRole('button', { name: 'Switch conversation', exact: true })
  const list = page.getByTestId('agent-sidebar-conversations')
  const [external, , native] = fixture.lanes[info.project.name]
  for (const name of ['AI chat', external.name, native.name]) {
    await choose(page, name, undefined, name === 'AI chat' ? fixture.personalChats.find(chat => chat.lane === info.project.name)!.title : name)
    const selectedTitle = await title.textContent()
    const composer = sidebar.locator('[data-ai-chat-composer-root]:not([inert]):visible')
    const editor = composer.locator('[contenteditable="true"]')
    await expect(editor).toBeVisible()
    await title.click()
    await expect(list).toBeVisible()
    const menu = (await list.boundingBox())!
    const boundary = (await composer.boundingBox())!
    expect(menu.y + menu.height).toBeLessThanOrEqual(boundary.y - 12)
    expect(await list.evaluate(node => node.scrollHeight > node.clientHeight), 'phone list scrolls above the composer').toBe(true)
    const box = (await editor.boundingBox())!
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    expect(await editor.evaluate((node, point) => {
      const target = document.elementFromPoint(point.x, point.y)
      return node.contains(target) && !target?.closest('#agent-sidebar-conversations')
    }, point), 'composer center hits the editor, never a conversation row').toBe(true)
    await page.touchscreen.tap(point.x, point.y)
    await expect(list).toBeHidden()
    await expect(editor).toBeFocused()
    await expect(title).toHaveText(selectedTitle!)
    await expect(sidebar).toBeVisible()
  }
})

test('conversation rows contain two-line titles without overlap on desktop and phone', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'Desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
  await open(page, info.project.name)
  const longChat = fixture.personalChats.find(chat => chat.lane === info.project.name && !/\s/.test(chat.title) && chat.title.length > 150)
  expect(longChat, 'fixture includes a long unbroken conversation title').toBeDefined()
  const list = page.getByTestId('agent-sidebar-conversations')
  await page.getByRole('button', { name: 'Switch conversation', exact: true }).click()
  await expect(list).toBeVisible()
  const longRow = list.locator(`[data-command-key="session:${longChat!.id}"]`)
  await expect(longRow).toHaveText(longChat!.title)
  await longRow.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  const boxes = await list.locator('li').evaluateAll(rows => rows.map(row => {
    const title = row.querySelector<HTMLElement>(':scope > span.line-clamp-2')!
    const rowBox = row.getBoundingClientRect()
    const titleBox = title.getBoundingClientRect()
    const style = getComputedStyle(title)
    return {
      key: row.getAttribute('data-command-key'), top: rowBox.top, bottom: rowBox.bottom,
      left: rowBox.left, right: rowBox.right, height: rowBox.height,
      titleTop: titleBox.top, titleBottom: titleBox.bottom, titleLeft: titleBox.left, titleRight: titleBox.right,
      titleHeight: titleBox.height, lineHeight: parseFloat(style.lineHeight),
      clamp: style.webkitLineClamp, overflow: style.overflow, overflowWrap: style.overflowWrap,
      scrollHeight: row.scrollHeight, clientHeight: row.clientHeight,
      titleScrollWidth: title.scrollWidth, titleClientWidth: title.clientWidth,
    }
  }))
  expect(boxes.length).toBeGreaterThan(1)
  for (const [index, box] of boxes.entries()) {
    if (index > 0) expect(box.top, `${box.key} does not overlap the previous row`).toBeGreaterThanOrEqual(boxes[index - 1].bottom)
    expect(box.titleTop).toBeGreaterThanOrEqual(box.top)
    expect(box.titleBottom).toBeLessThanOrEqual(box.bottom)
    expect(box.titleLeft).toBeGreaterThanOrEqual(box.left)
    expect(box.titleRight).toBeLessThanOrEqual(box.right)
    expect(box.titleHeight).toBeLessThanOrEqual(2 * box.lineHeight + 1)
    expect(box.clamp).toBe('2')
    expect(box.overflow).toBe('hidden')
    expect(box.overflowWrap).toBe('anywhere')
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1)
    expect(box.titleScrollWidth).toBeLessThanOrEqual(box.titleClientWidth + 1)
    if (info.project.name === 'Mobile') expect(box.height).toBeGreaterThanOrEqual(52)
  }
  const longBox = boxes.find(box => box.key === `session:${longChat!.id}`)!
  expect(longBox.titleHeight).toBeGreaterThan(longBox.lineHeight + 1)
  if (info.project.name === 'Desktop') expect(longBox.height).toBeGreaterThan(36)
  await longRow.click()
  await expect(list).toBeHidden()
  await expect(page.getByRole('button', { name: 'Switch conversation', exact: true })).toHaveText(longChat!.title)
  await expect(page.getByTestId('ai-sidebar').getByText(longChat!.message, { exact: true })).toBeVisible()
})

test('past chats are listed newest first above agents and reopen', async ({ page }, info) => {
  await open(page, info.project.name)
  const title = page.getByRole('button', { name: 'Switch conversation', exact: true })
  const list = page.getByTestId('agent-sidebar-conversations')
  if (!await list.isVisible()) await title.click()
  const chats = fixture.personalChats.filter(chat => chat.lane === info.project.name).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  await expect(list.locator('li').first()).toHaveText('AI chat')
  for (const chat of chats) {
    const row = list.locator(`[data-command-key="session:${chat.id}"]`)
    await reveal(list, row)
    await expect(row).toHaveText(chat.title)
  }
  const keys = await list.locator('li').evaluateAll(rows => rows.map(row => row.getAttribute('data-command-key')))
  const positions = chats.map(chat => keys.indexOf(`session:${chat.id}`))
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
  const agentPositions = fixture.lanes[info.project.name].map(agent => keys.indexOf(agent.id))
  for (const position of positions) {
    expect(position).toBeGreaterThan(0)
    for (const agentPosition of agentPositions) expect(position).toBeLessThan(agentPosition)
  }
  const [external, , native] = fixture.lanes[info.project.name]
  for (const [index, chat] of chats.entries()) {
    await choose(page, index % 2 ? native.name : external.name)
    await choose(page, chat.title)
    await expect(page.getByTestId('ai-sidebar').getByText(chat.message, { exact: true })).toBeVisible()
    await expect(page.locator('#ai-chat-tiptap-editor .ProseMirror:visible')).toBeVisible()
    await expect(title).toHaveText(chat.title)
    await choose(page, native.name)
    await choose(page, 'AI chat', undefined, chat.title)
    await expect(page.getByTestId('ai-sidebar').getByText(chat.message, { exact: true })).toBeVisible()
  }
})

test('an unnamed personal conversation falls back to AI chat in the header', async ({ page }, info) => {
  const chat = fixture.personalChats.find(chat => chat.lane === info.project.name)!
  await page.route('**/api/ai-chat/all-sessions*', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    if (body.session?.id === chat.id) body.session.title = ''
    if (body.sessions) body.sessions = body.sessions.map((session: { id: string; title: string }) => session.id === chat.id ? { ...session, title: '' } : session)
    await route.fulfill({ response, json: body })
  })
  await page.goto(withRealtime(`/project?id=${fixture.projectId}&surface=board&agentSidebar=1`))
  const list = page.getByTestId('agent-sidebar-conversations')
  await expect(list).toBeVisible()
  const row = list.locator(`[data-command-key="session:${chat.id}"]`)
  await reveal(list, row)
  await row.click()
  await expect(list).toBeHidden()
  await expect(page.getByTestId('ai-sidebar').getByText(chat.message, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch conversation', exact: true })).toHaveText('AI chat')
})

for (const theme of ['porcelain', 'graphite', 'amoled', 'dia']) {
  test(`${theme}: anchored switch, real polling round trip, independent drafts/history and shell`, async ({ page, request }, info) => {
    test.setTimeout(90_000)
    const [a, b] = fixture.lanes[info.project.name]
    const historyResponses: Response[] = []
    page.on('response', (response) => {
      if (/^\/api\/agent-chat\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET') historyResponses.push(response)
    })
    const clearedDraft = await request.patch(`/api/agent-chat/${b.sessionId}/participant`, {
      headers: { 'x-hypertask-sidebar-project': String(fixture.projectId) }, data: { draft: '' },
    })
    expect(clearedDraft.status()).toBe(200)
    await heartbeat(request, a)
    await page.context().addCookies([{ name: 'theme', value: theme, url: process.env.BASE_URL! }])
    const flags = await open(page, info.project.name)
    const title = page.getByRole('button', { name: 'Switch conversation', exact: true })
    const list = page.getByTestId('agent-sidebar-conversations')
    if (!await list.isVisible()) await title.click()
    await expect(list.locator('li').first()).toHaveText('AI chat')
    await expect(list.locator(`[data-command-key="${a.id}"]`)).toHaveText(`${a.name} · polling`)
    await expect(list.locator(`[data-command-key="${b.id}"]`)).toHaveText(b.name)
    const trigger = await settledBox(title)
    if (info.project.name === 'Mobile') {
      expect(trigger.height).toBeGreaterThanOrEqual(44)
      expect(trigger.width).toBeGreaterThanOrEqual(44)
      for (const row of await list.locator('li').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(52)
    }
    const menu = await settledBox(list)
    expect(await title.boundingBox()).toEqual(trigger)
    expect(menu.y).toBeGreaterThanOrEqual(trigger.y + trigger.height)
    expect(menu.y - trigger.y - trigger.height).toBeLessThan(12)
    expect(Math.abs(menu.x - trigger.x)).toBeLessThan(16)
    expect(menu.x + menu.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ai-sidebar'), 'Escape closes the picker, not the mobile sheet').toBeVisible()
    await expect(list).toBeHidden()
    await expect(title).toBeFocused()
    await title.click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(list).toBeHidden()
    const aiEditor = page.locator('#ai-chat-tiptap-editor .ProseMirror:visible')
    await aiEditor.fill('AI draft stays here')
    const aiComposer = (await aiEditor.boundingBox())!
    const boardCard = page.locator('[id^="task-"]').first()
    const boardBefore = await boardCard.boundingBox()

    const seedHistory = await request.get(`/api/agent-chat/${a.sessionId}`, { headers: { 'x-hypertask-sidebar-project': String(fixture.projectId) } })
    const seedBody = await seedHistory.text()
    expect(seedHistory.status(), `seed history: ${seedBody}`).toBe(200)
    expect(JSON.parse(seedBody).messages.map((message: { content: string }) => message.content)).toContain(`${a.name} history 1`)
    const [opened] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/agent-sidebar-chats' && response.request().method() === 'POST', { timeout: 15_000 }),
      choose(page, a.name),
    ])
    const openedBody = await opened.text()
    expect(opened.status(), `open agent A: ${openedBody}`).toBe(200)
    expect(JSON.parse(openedBody).session?.id, openedBody).toBe(a.sessionId)
    await expect.poll(() => historyResponses.length, { timeout: 15_000, message: `agent A history GET after successful open for ${a.sessionId}` }).toBeGreaterThan(0)
    const loadedHistory = historyResponses[0]
    expect(new URL(loadedHistory.url()).pathname).toBe(`/api/agent-chat/${a.sessionId}`)
    expect(loadedHistory.request().headers()['x-hypertask-sidebar-project']).toBe(String(fixture.projectId))
    const historyBody = await loadedHistory.text()
    expect(loadedHistory.status(), historyBody).toBe(200)
    const history = JSON.parse(historyBody)
    expect(history.success, historyBody).toBe(true)
    expect(history.messages.map((message: { content: string }) => message.content)).toContain(`${a.name} history 1`)
    const aEditor = page.getByRole('textbox', { name: `Message ${a.name}`, exact: true })
    await expect(aEditor).toBeVisible()
    await expect(page.getByText(`${a.name} history 1`, { exact: true })).toBeVisible()
    await aEditor.fill('A draft only')
    const scroller = page.getByTestId('ai-sidebar').locator('div.overflow-y-auto').filter({ has: page.getByText(`${a.name} history 1`, { exact: true }) }).last()
    await scroller.evaluate((node) => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')) })
    await choose(page, b.name)
    const bEditor = page.getByRole('textbox', { name: `Message ${b.name}`, exact: true })
    await expect(bEditor).toBeEmpty()
    await bEditor.fill('B draft only')
    await choose(page, a.name)
    await expect(aEditor).toHaveText('A draft only')
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(10)
    const prompt = `Sidebar real prompt ${randomUUID()}`
    await aEditor.fill(prompt)
    const sentResponse = page.waitForResponse((response) => response.url().endsWith(`/api/agent-chat/${a.sessionId}/messages`) && response.request().method() === 'POST')
    await aEditor.press('Enter')
    const sent = await sentResponse
    expect(sent.status()).toBe(200)
    const sentMessage = (await sent.json()).message
    await expect(page.getByText(prompt, { exact: true })).toBeVisible()
    const pending = await request.get('/api/mcp/chat/pending', { headers: { Authorization: `Bearer ${a.token}` } })
    expect(pending.status()).toBe(200)
    const claimed = (await pending.json()).messages.find((message: { id: string }) => message.id === sentMessage.id)
    expect(claimed?.sessionId).toBe(a.sessionId)
    if (flags['htpr-7734-agent-chat-context']) {
      expect(claimed.context).toBeDefined()
      expect(claimed.context.scope).toBe('board')
      expect(claimed.context.project_id).toBe(fixture.projectId)
      expect(claimed.text).toBe(`Context: board ${fixture.projectId} ${JSON.stringify(claimed.context.title)}\n\n${prompt}`)
    } else {
      expect(claimed).not.toHaveProperty('context')
      expect(claimed.text).toBe(prompt)
    }
    const second = await request.get('/api/mcp/chat/pending', { headers: { Authorization: `Bearer ${a.token}` } })
    expect((await second.json()).messages.some((message: { id: string }) => message.id === claimed.id)).toBe(false)
    await choose(page, b.name)
    const replyText = `Completed ${prompt}`
    const reply = await request.post(`/api/mcp/chat/sessions/${a.sessionId}/messages`, {
      headers: { Authorization: `Bearer ${a.token}` }, data: { text: replyText, replyToMessageId: claimed.id },
    })
    expect(reply.status()).toBe(200)
    await expect(bEditor).toHaveText('B draft only')
    await expect(page.getByText(replyText, { exact: true })).toBeHidden()
    await choose(page, a.name)
    await expect(page.getByText(replyText, { exact: true })).toBeVisible()
    const persisted = await request.get(`/api/agent-chat/${a.sessionId}`, { headers: { 'x-hypertask-sidebar-project': String(fixture.projectId) } })
    expect((await persisted.json()).messages.some((message: { content: string }) => message.content === replyText)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${theme}-${info.project.name}-agent.png`) })
    await choose(page, 'AI chat', undefined, fixture.personalChats.find(chat => chat.lane === info.project.name)!.title)
    await expect(aiEditor).toHaveText('AI draft stays here')
    const aiAfter = (await aiEditor.boundingBox())!
    expect(Math.abs(aiAfter.y - aiComposer.y)).toBeLessThan(2)
    expect(Math.abs(aiAfter.height - aiComposer.height)).toBeLessThan(2)
    expect(await boardCard.boundingBox()).toEqual(boardBefore)
    await page.getByRole('button', { name: 'Chat history', exact: true }).click()
    await expect(page.locator('#ai-chat-session-history').getByRole('button', { name: fixture.personalChats.find(chat => chat.lane === info.project.name)!.title, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    if (info.project.name === 'Desktop') {
      const resize = page.getByTestId('ai-sidebar').getByRole('separator')
      const box = (await resize.boundingBox())!
      const width = (await page.getByTestId('ai-sidebar').boundingBox())!.width
      await page.mouse.move(box.x + box.width / 2, box.y + 60)
      await page.mouse.down()
      await page.mouse.move(box.x - 40, box.y + 60)
      await page.mouse.up()
      expect((await page.getByTestId('ai-sidebar').boundingBox())!.width).toBeGreaterThan(width)
    } else {
      await page.getByRole('button', { name: 'Close AI chat', exact: true }).click()
      await expect(page.getByTestId('ai-sidebar')).toBeHidden()
    }
    await page.screenshot({ path: info.outputPath(`${theme}-${info.project.name}.png`) })
  })
}

test('open error retries the same selected agent; outside click and native transport preserve the board', async ({ page }, info) => {
  const [a, , native] = fixture.lanes[info.project.name]
  const flags = await open(page, info.project.name)
  await choose(page, 'AI chat', undefined, fixture.personalChats.find(chat => chat.lane === info.project.name)!.title)
  const aiDraft = `General draft ${randomUUID()}`
  await page.locator('#ai-chat-tiptap-editor .ProseMirror:visible').fill(aiDraft)
  let fail = true
  await page.route('**/api/agent-sidebar-chats', async (route) => {
    if (route.request().method() === 'POST' && fail) {
      fail = false
      await route.fulfill({ status: 503, json: { error: 'Runtime unavailable' } })
    } else await route.continue()
  })
  await choose(page, a.name, 'Runtime unavailable')
  await expect(page.getByText('Runtime unavailable', { exact: true })).toBeVisible()
  await choose(page, a.name)
  await expect(page.getByRole('textbox', { name: `Message ${a.name}` })).toBeVisible()
  await expect(page.getByText('Runtime unavailable', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Switch conversation' }).click()
  await dismissConversationsOutside(page)
  await choose(page, native.name)
  const prompt = `Native sidebar ${randomUUID()}`
  const replyText = `Native transport reply to ${prompt}`
  const stream = page.waitForRequest((req) => req.url().endsWith('/api/ai/chat/stream') && req.method() === 'POST')
  await page.route('**/api/ai/chat/stream', (route) => route.fulfill({ contentType: 'text/event-stream', body: `event: content\ndata: ${JSON.stringify({ content: replyText })}\n\nevent: done\ndata: {"status":"complete"}\n\n` }))
  const editor = page.locator('#ai-chat-tiptap-editor .ProseMirror:visible')
  await editor.fill(prompt)
  await editor.press('Enter')
  const sent = await stream
  expect(sent.postDataJSON().session_id).toBe(native.sessionId)
  expect(sent.headers()['x-hypertask-sidebar-project']).toBe(String(fixture.projectId))
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(replyText, { exact: true })).toHaveCount(1)
  await expect(page.getByText(replyText, { exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/project')
  await choose(page, a.name)
  await page.getByRole('button', { name: 'Close AI chat', exact: true }).click()
  await expect(page.getByTestId('ai-sidebar')).toBeHidden()
  if (info.project.name === 'Desktop') await page.getByRole('button', { name: 'Open AI chat', exact: true }).click()
  else await page.getByRole('button', { name: 'AI', exact: true }).click()
  if (flags['htpr-8048-agent-sessions'] && info.project.name === 'Mobile') {
    await expect(page.getByRole('textbox', { name: `Message ${a.name}`, exact: true })).toBeVisible()
    await choose(page, 'AI chat', undefined, fixture.personalChats.find(chat => chat.lane === info.project.name)!.title)
  }
  await expect(page.locator('#ai-chat-tiptap-editor .ProseMirror:visible')).toHaveText(aiDraft)
})

test('flag-off client comparison restores the legacy title/history and never requests the new roster', async ({ page }, info) => {
  let rosterRequests = 0
  await page.route('**/api/flags', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, flags: { ...body.flags, [FLAG]: false } } })
  })
  page.on('request', (request) => { if (request.url().includes('/api/agent-sidebar-chats')) rosterRequests++ })
  const flagResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/flags' && response.ok())
  await page.goto(withRealtime(`/project?id=${fixture.projectId}&surface=board`))
  await flagResponse
  await expect(page.getByRole('button', { name: 'Switch conversation' })).toHaveCount(0)
  const sidebar = page.getByTestId('ai-sidebar')
  const opener = page.getByRole('button', { name: info.project.name === 'Desktop' ? 'Open AI chat' : 'AI', exact: true })
  await expect(sidebar.or(opener).first()).toBeVisible()
  if (!(await sidebar.isVisible())) await opener.click()
  await expect(sidebar).toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch conversation' })).toHaveCount(0)
  await expect(page.getByTestId('agent-sidebar-conversations')).toHaveCount(0)
  await expect(page.locator('#ai-chat-tiptap-editor .ProseMirror:visible')).toBeVisible()
  expect(rosterRequests).toBe(0)
})

test('switching chats does not move the ticket, its comments or its comment composer', async ({ page }, info) => {
  await page.goto(withRealtime(`/detail/project-${fixture.projectId}/1?agentSidebar=1`))
  await expect(page.getByTestId('ai-sidebar')).toBeVisible()
  await expect(page.getByTestId('comment-composer')).toBeAttached()
  await expect(page.getByTestId('ticket-comment')).toHaveCount(2)
  await waitForTicketInitialScroll(page)
  await page.evaluate(() => document.fonts.ready)
  const selectors = ['#title-input', '[data-testid="ticket-description"]', '[data-testid="ticket-comment"]', '[data-testid="comment-composer"]']
  const measure = () => Promise.all(selectors.map((selector) => page.locator(selector).first().boundingBox()))
  let settled = await measure()
  await expect.poll(async () => {
    const next = await measure()
    const stable = JSON.stringify(next) === JSON.stringify(settled)
    settled = next
    return stable
  }, { message: 'the ticket layout must settle before switching chats', intervals: [500], timeout: 10_000 }).toBe(true)
  const before = settled
  for (const box of before) expect(box).not.toBeNull()
  await choose(page, fixture.lanes[info.project.name][0].name)
  await page.evaluate(() => document.fonts.ready)
  const after = await Promise.all(selectors.map((selector) => page.locator(selector).first().boundingBox()))
  expect(after).toEqual(before)
  if (info.project.name === 'Mobile') {
    expect(await page.evaluate(() => window.__htHandleBack?.())).toBe(true)
  } else await page.getByRole('button', { name: 'Close AI chat', exact: true }).click()
  await expect(page.getByTestId('ai-sidebar')).toBeHidden()
})

test('new flag On keeps activity hidden with parked room and fullscreen flags Off', async ({ page }, info) => {
  await page.route('**/api/flags', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, flags: { ...body.flags,
      [FLAG]: true, 'htpr-6557-agent-rooms': false, 'htpr-6476-mobile-agent-chat-fullscreen': false,
    } } })
  })
  await open(page, info.project.name)
  const agent = fixture.lanes[info.project.name][1]
  await choose(page, agent.name)
  await expect(page.getByRole('textbox', { name: `Message ${agent.name}` })).toBeVisible()
  await expect(page.getByTestId('ai-sidebar').locator('[data-agent-chat-ai-composer]')).toBeVisible()
  await expect(page.getByTestId('ai-sidebar').getByText('Activity', { exact: true })).toHaveCount(0)
})
