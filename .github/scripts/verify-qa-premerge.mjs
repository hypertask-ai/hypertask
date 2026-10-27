import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FEATURE_MAP_DIR = '.claude/skills/verify-qa/reference/feature-map'

export const FEATURE_MAP_CATALOG = [
  { page: 'inbox.md', journey: ['inbox-cycle'], prefixes: [
    'src/app/inbox/',
    'src/pages/api/notifications/',
    'src/pages/api/queues/inboxQueue.ts',
    'src/pages/api/queues/inboxReminder.ts',
    'e2e/smoke/inbox-cycle.spec.ts',
    '.claude/skills/verify-qa/scripts/inbox-cycle-live.mjs',
  ]},
  { page: 'login.md', journey: ['login'], prefixes: ['src/proxy.ts', 'src/lib/auth/'] },
  { page: 'boards-and-views.md', journey: ['open-board', 'switch-boards', 'drag-card'], prefixes: ['src/components/PageComponents/Kanban/'] },
  { page: 'task-detail-and-description.md', journey: ['open-task', 'edit-description'], prefixes: ['src/components/PageComponents/TaskDetail/'] },
  { page: 'comments-and-mentions.md', journey: ['add-comment'], prefixes: ['src/pages/api/comments/'] },
  { page: 'create-task-attachments.md', journey: ['create-task'], prefixes: ['src/components/RTE/TiptapCreateTaskModal.tsx'] },
  { page: 'quick-entry-cards.md', journey: ['create-task'], prefixes: ['src/components/Common/newTask.tsx'] },
  { page: 'ai-chat.md', journey: ['ai-chat'], prefixes: ['src/app/api/ai/', 'src/lib/aiModelOptions.ts'] },
  { page: 'board-invites.md', journey: null, prefixes: [
    'src/components/Modals/commands/inviteMember.tsx',
    'src/hooks/MultiPages/useInviteCallbackHandlers.ts',
    'src/pages/api/invite/',
  ]},
  { page: 'board-member-list.md', journey: null, prefixes: [
    'src/components/Modals/Settings/BoardMembersSection.tsx',
    'src/components/Modals/Settings/MembersSection.tsx',
    'src/pages/api/members/',
  ]},
  { page: 'figma-connect.md', journey: null, prefixes: [
    'src/components/Modals/Settings/AccountsSection.tsx',
    'src/pages/api/figma/',
  ]},
  { page: 'cli-install.md', journey: null, prefixes: ['src/lib/onboarding/installCommands.ts'] },
  { page: 'task-share-links.md', journey: null, prefixes: ['src/pages/api/share/'] },
  { page: 'search-and-filters.md', journey: null, prefixes: ['src/pages/api/search/'] },
  { page: 'billing-and-plans.md', journey: ['plan-check'], prefixes: ['src/components/Modals/Settings/BillingSection.tsx', 'src/app/settings/billing/'] },
  { page: 'my-tasks.md', journey: null, prefixes: ['src/app/my-tasks/'] },
]

function prefixHits(file, prefix) {
  if (prefix.endsWith('/')) return file.startsWith(prefix)
  return file === prefix || file.startsWith(`${prefix}/`)
}

export function selectJourney(files, catalog = FEATURE_MAP_CATALOG) {
  const counts = new Map()
  for (const file of files) {
    if (typeof file !== 'string' || file.length === 0) continue
    let winner = null
    for (const entry of catalog) {
      for (const prefix of entry.prefixes) {
        if (!prefixHits(file, prefix)) continue
        if (!winner || prefix.length > winner.prefix.length) winner = { entry, prefix }
      }
    }
    if (!winner) continue
    counts.set(winner.entry.page, (counts.get(winner.entry.page) || 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const topCount = ranked[0]?.[1] ?? 0
  const leaders = ranked.filter(([, count]) => count === topCount).map(([page]) => page)
  const tied = leaders.length > 1
  const matched = !tied && leaders.length === 1 ? leaders[0] : null
  const matchedEntry = catalog.find((entry) => entry.page === matched)
  const journey = matchedEntry?.journey || null
  let reason = 'matched'
  if (ranked.length === 0) reason = 'no feature-map page matched the diff'
  else if (tied) reason = `tie: ${leaders.join(', ')}`
  else if (!journey) reason = `no premerge driver for ${matched}`
  return {
    matchedPage: matched,
    journey,
    reason,
    featureMap: matched ? `${FEATURE_MAP_DIR}/${matched}` : null,
    counts: Object.fromEntries(ranked),
  }
}

export function assertLoopback(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('verify-qa base is not a URL')
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`verify-qa refuses non-loopback base ${url.hostname}`)
  }
  if (url.protocol !== 'http:') throw new Error('verify-qa refuses a non-http loopback base')
  return url.origin
}

export async function readChangedFiles(filePath) {
  if (!filePath) return []
  try {
    const text = await readFile(filePath, 'utf8')
    return text.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function reportOnly() {
  return process.env.VERIFY_QA_REPORT_ONLY === '1'
}

async function writeEvidence(outDir, result) {
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2))
  const lines = [
    `Feature map: ${result.featureMap}`,
    `Journey: ${result.journey}`,
    `Matched page: ${result.matchedPage || 'none'}`,
    `Selection: ${result.selectionReason}`,
    `Verdict: ${result.verdict}`,
    result.failure ? `Failure: ${result.failure}` : null,
    `Base: ${result.base}`,
    'Cleanup: the disposable browser-smoke database is discarded with the job. This directory is the evidence and is kept.',
    '',
    '## Cases',
    ...(result.steps || []).map((step) => `- ${step.pass ? 'PASS' : 'FAIL'}: ${step.name}`),
    '',
    '## Screenshots',
    ...(result.screenshots || []).map((file) => `- ${file}`),
    '',
  ].filter((line) => line !== null)
  await writeFile(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const run = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      '## Premerge verify-qa (report only)',
      '',
      `Verdict: **${result.verdict}**`,
      `Journey: \`${result.journey}\``,
      `Feature map: \`${result.featureMap}\``,
      `Matched page: ${result.matchedPage || 'none'} (${result.selectionReason})`,
      result.failure ? `Failure: ${result.failure}` : null,
      run ? `Run: ${run}` : null,
      'Artifact: `verify-qa-premerge` (screenshots, result.json, summary.md).',
      '',
    ].filter(Boolean).join('\n'))
  }
}

function finish(result) {
  const failed = result.verdict !== 'PASS'
  console.log(failed ? `::warning::verify-qa ${result.verdict}: ${result.failure || result.selectionReason}` : 'verify-qa ok')
  process.exitCode = reportOnly() || !failed ? 0 : 1
}

async function shot(page, outDir, screenshots, name) {
  const file = `${String(screenshots.length + 1).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: path.join(outDir, file) })
  screenshots.push(file)
  return file
}

async function openState(page, item, counter) {
  await page.waitForURL((url) => new URL(url).pathname === item.detailPath, { timeout: 30_000 })
  const current = new URL(page.url())
  const counterText = await page.getByText(/^\d+ \/ \d+$/).first().textContent({ timeout: 10_000 }).catch(() => null)
  const titleVisible = await page.getByText(item.title).first().isVisible().catch(() => false)
  const inboxFlow = current.searchParams.get('inboxFlow') === 'true'
  return {
    pass: inboxFlow && counter.test(counterText || '') && titleVisible,
    detail: {
      url: `${current.pathname}${current.search}`,
      inboxFlow,
      counter: counterText,
      title: item.title,
      titleVisible,
    },
  }
}

function watchArchive(page) {
  return page.waitForResponse((response) => /\/api\/notifications\/markAsDone/.test(response.url()), { timeout: 15_000 })
    .then(async (response) => {
      const body = await response.json().catch(() => null)
      return { http: response.status(), status: body?.status ?? null }
    }, () => ({ http: null, status: null }))
}

async function normalTaskIds(page) {
  const response = await page.request.get('/api/notifications/getAll')
  const body = await response.json().catch(() => null)
  const notifications = Array.isArray(body?.notifications) ? body.notifications : []
  return {
    http: response.status(),
    ids: notifications.filter((row) => row.status === 'Normal').map((row) => row.taskId),
  }
}

async function sendComment(page, text) {
  const editor = page.getByTestId('comment-composer').locator('.ProseMirror[contenteditable="true"]')
  await editor.waitFor({ state: 'visible', timeout: 15_000 })
  const deadline = Date.now() + 15_000
  let typed = ''
  while (Date.now() < deadline) {
    await editor.click()
    typed = await editor.innerText()
    if (!typed.includes(text)) await page.keyboard.insertText(text)
    typed = await editor.innerText()
    if (typed.includes(text)) break
    await page.waitForTimeout(200)
  }
  if (!typed.includes(text)) throw new Error('comment text did not land in the box')
  const created = page.waitForRequest((request) => /\/api\/comments\/create/.test(request.url()) && request.method() === 'POST', { timeout: 8_000 }).then(() => true, () => false)
  await page.keyboard.press('Control+Enter')
  if (!(await created)) throw new Error('Control+Enter sent no comment')
}

async function pressOutsideEditor(page, key) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await page.keyboard.press(key)
}

async function runSeededInboxCycle({ base, stateFile, items, outDir }) {
  const { chromium } = createRequire(path.join(root, 'package.json'))('playwright')
  const screenshots = []
  const steps = []
  let stopped = false
  let browser
  let page
  const runId = process.env.GITHUB_RUN_ID || 'local'
  try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: base,
    storageState: stateFile,
  })
  page = await context.newPage()
  async function gate(name, fn) {
    if (stopped) return
    try {
      const outcome = await fn()
      steps.push({ name, pass: outcome.pass, detail: outcome.detail })
      console.log(`${outcome.pass ? 'PASS' : 'FAIL'}: ${name}`)
      if (!outcome.pass) {
        stopped = true
        await shot(page, outDir, screenshots, 'failure').catch(() => {})
      }
    } catch (error) {
      const detail = { error: String(error.message || error).split('\n')[0] }
      steps.push({ name, pass: false, detail })
      console.log(`FAIL: ${name} ${detail.error}`)
      stopped = true
      await shot(page, outDir, screenshots, 'failure').catch(() => {})
    }
  }
    await gate('inbox lists the seeded reminder', async () => {
      await page.goto('/inbox?realtime=on', { waitUntil: 'domcontentloaded' })
      await page.getByText(items[0].title).first().waitFor({ timeout: 30_000 })
      await shot(page, outDir, screenshots, 'inbox')
      return { pass: true, detail: { title: items[0].title, url: new URL(page.url()).pathname } }
    })
    await gate('open by Enter keeps inboxFlow', async () => {
      await page.waitForTimeout(1500)
      await page.keyboard.press('Enter')
      const state = await openState(page, items[0], /^1 \/ 5$/)
      await shot(page, outDir, screenshots, 'enter-open')
      return state
    })
    await gate('send a comment archives and opens the next message', async () => {
      const archive = watchArchive(page)
      await sendComment(page, `Premerge verify-qa keyboard ${runId}`)
      const settled = await archive
      const state = await openState(page, items[1], /^2 \/ 5$/)
      const inbox = await normalTaskIds(page)
      await shot(page, outDir, screenshots, 'after-keyboard-send')
      const archived = settled.http === 200 && settled.status === 'Archive' && !inbox.ids.includes(items[0].taskId)
      return {
        pass: state.pass && archived,
        detail: { ...state.detail, archive: settled, openedTaskStillNormal: inbox.ids.includes(items[0].taskId) },
      }
    })
    await gate('open by click keeps inboxFlow', async () => {
      await page.goto('/inbox?realtime=on', { waitUntil: 'domcontentloaded' })
      await page.getByText(items[1].title).first().waitFor({ timeout: 30_000 })
      const firstGone = (await page.getByText(items[0].title).count()) === 0
      await page.getByText(items[1].title).first().click()
      const state = await openState(page, items[1], /^1 \/ 4$/)
      await shot(page, outDir, screenshots, 'click-open')
      return { pass: state.pass && firstGone, detail: { ...state.detail, previousMessageGone: firstGone } }
    })
    await gate('send a comment after a click archives and opens the next message', async () => {
      const archive = watchArchive(page)
      await sendComment(page, `Premerge verify-qa click ${runId}`)
      const settled = await archive
      const state = await openState(page, items[2], /^\d+ \/ \d+$/)
      const inbox = await normalTaskIds(page)
      await shot(page, outDir, screenshots, 'after-click-send')
      const archived = settled.http === 200 && settled.status === 'Archive' && !inbox.ids.includes(items[1].taskId)
      return { pass: state.pass && archived, detail: { ...state.detail, archive: settled } }
    })
    await gate('J opens the next message and keeps inboxFlow', async () => {
      await pressOutsideEditor(page, 'j')
      const state = await openState(page, items[3], /^\d+ \/ \d+$/)
      const inbox = await normalTaskIds(page)
      await shot(page, outDir, screenshots, 'after-j')
      return {
        pass: state.pass && inbox.ids.includes(items[2].taskId),
        detail: { ...state.detail, skippedMessageStillNormal: inbox.ids.includes(items[2].taskId) },
      }
    })
    await gate('E archives and opens the next message', async () => {
      const archive = watchArchive(page)
      await pressOutsideEditor(page, 'e')
      const settled = await archive
      const state = await openState(page, items[4], /^\d+ \/ \d+$/)
      const inbox = await normalTaskIds(page)
      await shot(page, outDir, screenshots, 'after-e')
      const archived = settled.http === 200 && settled.status === 'Archive' && !inbox.ids.includes(items[3].taskId)
      return { pass: state.pass && archived, detail: { ...state.detail, archive: settled } }
    })
    await gate('reload shows J kept its message and E removed its message', async () => {
      await page.goto('/inbox?realtime=on', { waitUntil: 'domcontentloaded' })
      await page.getByText(items[2].title).first().waitFor({ timeout: 30_000 })
      const kept = await page.getByText(items[2].title).first().isVisible()
      const last = await page.getByText(items[4].title).first().isVisible()
      const clickArchived = (await page.getByText(items[1].title).count()) === 0
      const eArchived = (await page.getByText(items[3].title).count()) === 0
      const inbox = await normalTaskIds(page)
      await shot(page, outDir, screenshots, 'inbox-after-reload')
      return {
        pass: kept && last && clickArchived && eArchived && inbox.ids.includes(items[2].taskId) && !inbox.ids.includes(items[3].taskId),
        detail: {
          keptByJ: kept,
          lastStillThere: last,
          clickArchived,
          eArchived,
          normalTaskIds: inbox.ids,
        },
      }
    })
  } finally {
    await browser?.close()
  }
  return { steps, screenshots }
}

async function loadInboxFixture(fixturePath) {
  const parsed = JSON.parse(await readFile(fixturePath, 'utf8'))
  const items = parsed.items
  if (!Array.isArray(items) || items.length !== 5) throw new Error('inbox fixture must contain 5 items')
  for (const item of items) {
    if (!Number.isInteger(item.taskId) || typeof item.title !== 'string' || typeof item.detailPath !== 'string') {
      throw new Error('inbox fixture item is missing taskId, title, or detailPath')
    }
  }
  return items
}

export async function runTaggedJourneys({ base, journey, outDir }, execute = spawnSync) {
  const reportFile = path.join(outDir, 'journeys.json')
  const run = execute(process.execPath, [
    path.join(root, 'node_modules/@playwright/test/cli.js'),
    'test', '-c', 'playwright.config.smoke.ts', '--project=journeys',
    '--grep', `@id:(${journey.join('|')})(\\s|$)`,
    '--workers=1', '--retries=0', '--global-timeout=140000', '--reporter=json',
    `--output=${path.join(outDir, 'test-results')}`,
  ], {
    cwd: root,
    env: {
      ...process.env,
      BASE_URL: base,
      SMOKE_BASE_URL: base,
      HT_QA_JOURNEYS: '1',
      HT_QA_TIER: '',
      HT_QA_EXPECTED_PLAN: 'Free',
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
    },
    encoding: 'utf8',
    timeout: 150_000,
  })
  if (run.error) throw new Error(`journey runner: ${run.error.message}`)
  const report = JSON.parse(await readFile(reportFile, 'utf8'))
  const specs = []
  function collect(suite) {
    specs.push(...(suite.specs || []))
    for (const child of suite.suites || []) collect(child)
  }
  collect(report)
  const steps = journey.map((id) => {
    const spec = specs.find((entry) => entry.tags?.includes(`id:${id}`))
    const tests = spec?.tests || []
    const statuses = tests.flatMap((entry) => (entry.results || []).map((result) => result.status))
    const pass = statuses.length > 0 && statuses.every((status) => status === 'passed')
    return { name: id, pass, detail: { statuses, unreachable: !statuses.length || statuses.every((status) => status === 'skipped') } }
  })
  const failed = steps.filter((step) => !step.pass)
  let verdict = 'PASS'
  if (failed.length) verdict = failed.every((step) => step.detail.unreachable) ? 'UNREACHABLE' : 'FAIL'
  if (run.status !== 0 && verdict === 'PASS') verdict = 'FAIL'
  return {
    steps,
    screenshots: specs.flatMap((spec) => (spec.tests || []).flatMap((entry) => (entry.results || []).flatMap((result) =>
      (result.attachments || []).filter((attachment) => attachment.contentType === 'image/png' && attachment.path)
        .map((attachment) => path.relative(outDir, attachment.path))))),
    verdict,
    failure: verdict === 'PASS' ? null : `journey runner ${verdict}: ${failed.map((step) => step.name).join(', ') || `exit ${run.status}`}`,
  }
}

async function main() {
  const outDir = path.resolve(process.env.VERIFY_QA_OUT || 'verify-qa-premerge')
  const choice = selectJourney(await readChangedFiles(process.env.VERIFY_QA_CHANGED_FILES))
  const baseRaw = process.env.VERIFY_QA_BASE || process.env.BASE_URL || ''
  const result = {
    ticket: 'https://app.hypertask.ai/detail/project-4060/695',
    featureMap: choice.featureMap,
    matchedPage: choice.matchedPage,
    journey: choice.journey,
    selectionReason: choice.reason,
    counts: choice.counts,
    base: baseRaw,
    verdict: 'FAIL',
    failure: null,
    steps: [],
    screenshots: [],
    cleanup: 'Disposable browser-smoke database is discarded with the job. Evidence in this directory is kept.',
  }
  try {
    await mkdir(outDir, { recursive: true })
    if (!choice.journey) {
      result.verdict = 'UNREACHABLE'
      result.failure = `no driver: ${choice.reason}`
      await writeEvidence(outDir, result)
      finish(result)
      return
    }
    result.base = assertLoopback(baseRaw)
    if (!choice.journey.includes('inbox-cycle')) {
      Object.assign(result, await runTaggedJourneys({ base: result.base, journey: choice.journey, outDir }))
      await writeEvidence(outDir, result)
      finish(result)
      return
    }
    const stateFile = process.env.VERIFY_QA_STATE_FILE
    const fixturePath = process.env.VERIFY_QA_FIXTURE
    if (!stateFile || !fixturePath) throw new Error('VERIFY_QA_STATE_FILE and VERIFY_QA_FIXTURE are required')
    await access(stateFile)
    const items = await loadInboxFixture(fixturePath)
    const run = await runSeededInboxCycle({ base: result.base, stateFile, items, outDir })
    result.steps = run.steps
    result.screenshots = run.screenshots
    const failed = run.steps.filter((step) => !step.pass)
    result.verdict = failed.length ? 'FAIL' : 'PASS'
    result.failure = failed.length ? failed.map((step) => step.name).join('; ') : null
  } catch (error) {
    result.verdict = 'FAIL'
    result.failure = String(error.message || error).split('\n')[0]
    result.steps = result.steps.length ? result.steps : [{ name: 'run', pass: false, detail: { error: result.failure } }]
  }
  await writeEvidence(outDir, result)
  finish(result)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
