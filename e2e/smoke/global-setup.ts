import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Confirms the smoke account can log in and has its seeded fixtures BEFORE any
// view test runs. Login, fixture, browser, or network failures are unrunnable:
// prod-health.yml alerts on them but never rolls back a healthy deployment.
const STATE_DIRECTORY = path.join(__dirname, '.state')
const PREFLIGHT_FILE = path.join(STATE_DIRECTORY, 'preflight.json')
const APPLICATION_FAILURE_FILE = path.join(STATE_DIRECTORY, 'application-failure.json')
const FIXTURE_FILE = path.join(STATE_DIRECTORY, 'fixture.json')
const INBOX_PATH = '/inbox'
const LOGIN_PATH = '/login'

function writePreflight(result: { ok: boolean; reason?: string }) {
  mkdirSync(STATE_DIRECTORY, { recursive: true })
  writeFileSync(PREFLIGHT_FILE, JSON.stringify(result))
}

function fail(reason: string): never {
  writePreflight({ ok: false, reason })
  throw new Error(reason)
}

function isBotChallenge(response: { headers(): Record<string, string> } | null): boolean {
  return response?.headers()['x-vercel-mitigated'] === 'challenge'
}

export default async function globalSetup(config: FullConfig) {
  writePreflight({ ok: false, reason: 'setup did not complete' })
  rmSync(APPLICATION_FAILURE_FILE, { force: true })
  rmSync(FIXTURE_FILE, { force: true })

  const project = config.projects[0]
  if (!project) fail('smoke config has no Playwright project')

  const { baseURL, storageState } = project.use
  if (typeof baseURL !== 'string' || !baseURL) fail('smoke config has no baseURL')
  if (typeof storageState !== 'string' || !storageState) fail('smoke config has no storageState file')

  const email = process.env.QA_LOGIN_EMAIL
  const password = process.env.QA_LOGIN_PASSWORD
  if (!email || !password) fail('QA smoke login credentials are not configured')

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ baseURL })
    const loginResponse = await context.request.post('/api/auth/qa-login', {
      data: { email, password },
      timeout: 20_000,
    })
    if (isBotChallenge(loginResponse)) fail('Vercel bot-challenged the QA smoke login')
    if (!loginResponse.ok()) fail(`QA smoke login got HTTP ${loginResponse.status()}`)

    const login = await loginResponse.json() as { success?: boolean; redirectUrl?: string }
    if (!login.success || typeof login.redirectUrl !== 'string') fail('QA smoke login returned an invalid response')

    const loginBoardId = /^\/project\?id=(\d+)$/.exec(login.redirectUrl)?.[1]
    if (!loginBoardId) fail('QA smoke account has no owned board')
    const boardId = '2144'

    const fixtureResponse = await context.request.post('/api/projects/boardTasks', {
      data: { projectId: Number(boardId) },
      timeout: 20_000,
    })
    if (isBotChallenge(fixtureResponse)) fail('Vercel bot-challenged the smoke fixture check')
    if (!fixtureResponse.ok()) fail(`smoke fixture check got HTTP ${fixtureResponse.status()}`)

    const fixture = await fixtureResponse.json() as {
      tasks?: Array<{ uniqueIndex?: unknown }>
    }
    if (!Array.isArray(fixture.tasks) || fixture.tasks.length < 2) {
      fail('QA smoke board needs at least two seeded cards')
    }
    const taskIndex = fixture.tasks.find(({ uniqueIndex }) =>
      Number.isInteger(uniqueIndex) && Number(uniqueIndex) > 0,
    )?.uniqueIndex
    if (!taskIndex) fail('QA smoke board has no seeded task with a valid index')

    writeFileSync(FIXTURE_FILE, JSON.stringify({
      boardPath: `/detail/project-${boardId}`,
      taskPath: `/detail/project-${boardId}/${taskIndex}`,
    }))
    await context.storageState({ path: storageState })

    const page = await context.newPage()
    let response
    try {
      response = await page.goto(INBOX_PATH, { waitUntil: 'load', timeout: 20_000 })
    } catch (err) {
      fail(`login check could not load ${INBOX_PATH}: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (isBotChallenge(response)) fail(`Vercel bot-challenged the login check on ${INBOX_PATH}`)
    if (!response || response.status() === 401 || response.status() === 403) {
      fail(`login check got HTTP ${response?.status() ?? 'no response'} on ${INBOX_PATH}`)
    }

    try {
      await page.waitForURL(`**${LOGIN_PATH}**`, { timeout: 3_000 })
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'TimeoutError') {
        fail(`login check failed while waiting for an auth redirect: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (page.url().includes(LOGIN_PATH)) {
      fail(`login check was redirected to ${LOGIN_PATH}`)
    }
  } finally {
    try {
      await browser.close()
    } catch (err) {
      fail(`login check browser could not close cleanly: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  writePreflight({ ok: true })
}
