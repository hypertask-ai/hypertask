import { test, expect, type Page, type APIRequestContext, type Response } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withRealtime } from './lib/realtime'
import { waitForTicketInitialScroll } from './lib/layout-lock-scroll'

const FLAG = 'htpr-7518-agent-sidebar-chats'
const PAST_CHATS_FLAG = 'htpr-7688-past-chats-first'
const stateFile = process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'
test.use({ storageState: stateFile })
test.describe.configure({ mode: 'serial' })
test.skip(!process.env.BROWSER_SMOKE_PR, 'Writes only to GitHub disposable loopback fixtures')

type Agent = { id: string; name: string; sessionId: string; token: string }
type PersonalChat = { id: string; title: string; updatedAt: string; message: string }
type Fixture = { projectId: number; lanes: Record<string, Agent[]>; personalChats: PersonalChat[] }
let fixture: Fixture

test.beforeAll(() => {
  expect(['127.0.0.1', 'localhost']).toContain(new URL(process.env.BASE_URL!).hostname)
  fixture = JSON.parse(readFileSync(path.join(path.dirname(stateFile), 'agent-sidebar-fixture.json'), 'utf8'))
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

async function open(page: Page) {
  await page.goto(withRealtime(`/project?id=${fixture.projectId}&surface=board&agentSidebar=1`))
  await expect(page.getByTestId('ai-sidebar')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch conversation', exact: true })).toBeVisible()
  const flags = await page.request.get('/api/flags')
  expect(flags.status()).toBe(200)
  const enabledFlags = (await flags.json()).flags
  expect(enabledFlags[FLAG], 'server sidebar flag in disposable fixture').toBe(true)
  expect(enabledFlags[PAST_CHATS_FLAG], 'past chats flag in disposable fixture').toBe(true)
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
async function choose(page: Page, name: string) {
  const list = page.getByTestId('agent-sidebar-conversations')
  if (!await list.isVisible()) await page.getByRole('button', { name: 'Switch conversation', exact: true }).click()
  const row = list.locator('li').filter({ hasText: name })
  const more = list.getByRole('option', { name: /^Show \d+ more$/ })
  if (!await row.first().isVisible() && await more.isVisible()) await more.click()
  await row.first().click()
  await expect(list).toBeHidden()
}

test('past chats are listed newest first above agents and reopen', async ({ page }, info) => {
  await open(page)
  const title = page.getByRole('button', { name: 'Switch conversation', exact: true })
  const list = page.getByTestId('agent-sidebar-conversations')
  if (!await list.isVisible()) await title.click()
  const chats = [...fixture.personalChats].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  await expect(list.locator('li').first()).toHaveText('AI chat')
  const more = list.getByRole('option', { name: /^Show \d+ more$/ })
  if (await more.isVisible()) await more.click()
  for (const chat of chats) await expect(list.locator(`[data-command-key="session:${chat.id}"]`)).toHaveText(chat.title)
  const keys = await list.locator('li').evaluateAll(rows => rows.map(row => row.getAttribute('data-command-key')))
  const positions = chats.map(chat => keys.indexOf(`session:${chat.id}`))
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
  const agentPositions = Object.values(fixture.lanes).flat().map(agent => keys.indexOf(agent.id))
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
    await expect(title).toHaveText('AI chat')
    await choose(page, native.name)
    await choose(page, 'AI chat')
    await expect(page.getByTestId('ai-sidebar').getByText(chat.message, { exact: true })).toBeVisible()
  }
})

for (const theme of ['porcelain', 'graphite', 'amoled', 'dia']) {
  test(`${theme}: anchored switch, real polling round trip, independent drafts/history and shell`, async ({ page, request }, info) => {
    test.setTimeout(90_000)
    const [a, b] = fixture.lanes[info.project.name]
    const historyResponses: Response[] = []
    page.on('response', (response) => {
      if (/^\/api\/agent-chat\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET') historyResponses.push(response)
    })
    await heartbeat(request, a)
    await page.context().addCookies([{ name: 'theme', value: theme, url: process.env.BASE_URL! }])
    await open(page)
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
    expect((await sentResponse).status()).toBe(200)
    await expect(page.getByText(prompt, { exact: true })).toBeVisible()
    const pending = await request.get('/api/mcp/chat/pending', { headers: { Authorization: `Bearer ${a.token}` } })
    expect(pending.status()).toBe(200)
    const claimed = (await pending.json()).messages.find((message: { text: string }) => message.text === prompt)
    expect(claimed?.sessionId).toBe(a.sessionId)
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
    await choose(page, 'AI chat')
    await expect(aiEditor).toHaveText('AI draft stays here')
    const aiAfter = (await aiEditor.boundingBox())!
    expect(Math.abs(aiAfter.y - aiComposer.y)).toBeLessThan(2)
    expect(Math.abs(aiAfter.height - aiComposer.height)).toBeLessThan(2)
    expect(await boardCard.boundingBox()).toEqual(boardBefore)
    await page.getByRole('button', { name: 'Chat history', exact: true }).click()
    await expect(page.locator('#ai-chat-session-history')).toBeVisible()
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
  await open(page)
  await choose(page, 'AI chat')
  const aiDraft = `General draft ${randomUUID()}`
  await page.locator('#ai-chat-tiptap-editor .ProseMirror:visible').fill(aiDraft)
  let fail = true
  await page.route('**/api/agent-sidebar-chats', async (route) => {
    if (route.request().method() === 'POST' && fail) {
      fail = false
      await route.fulfill({ status: 503, json: { error: 'Runtime unavailable' } })
    } else await route.continue()
  })
  await choose(page, a.name)
  await expect(page.getByText('Runtime unavailable', { exact: true })).toBeVisible()
  await choose(page, a.name)
  await expect(page.getByRole('textbox', { name: `Message ${a.name}` })).toBeVisible()
  await expect(page.getByText('Runtime unavailable', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Switch conversation' }).click()
  await page.getByTestId('ai-sidebar').getByRole('textbox', { name: `Message ${a.name}` }).click()
  await expect(page.getByTestId('agent-sidebar-conversations')).toBeHidden()
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
  const after = await Promise.all(selectors.map((selector) => page.locator(selector).first().boundingBox()))
  expect(after).toEqual(before)
  if (info.project.name === 'Mobile') {
    expect(await page.evaluate(() => window.__htHandleBack?.())).toBe(true)
  } else await page.getByRole('button', { name: 'Close AI chat', exact: true }).click()
  await expect(page.getByTestId('ai-sidebar')).toBeHidden()
})

test('new flag On works with parked room, mobile composer and activity flags Off', async ({ page }, info) => {
  await page.route('**/api/flags', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, flags: { ...body.flags,
      [FLAG]: true, 'htpr-6557-agent-rooms': false, 'htpr-6476-mobile-agent-chat-fullscreen': false,
      'htpr-6407-mobile-agent-chat-layout': false, 'htpr-6094-agent-activity-rows': false,
    } } })
  })
  await open(page)
  const agent = fixture.lanes[info.project.name][1]
  await choose(page, agent.name)
  await expect(page.getByRole('textbox', { name: `Message ${agent.name}` })).toBeVisible()
  await expect(page.getByTestId('ai-sidebar').locator('[data-agent-chat-ai-composer]')).toBeVisible()
  await expect(page.getByTestId('ai-sidebar').getByText('Activity', { exact: true })).toHaveCount(0)
})
