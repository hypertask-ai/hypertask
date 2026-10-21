import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const baseURL = 'https://app.hypertask.ai'
export const ticketPattern = /^(HTPR|HYFA|YPER4)-[1-9][0-9]*$/
const root = fileURLToPath(new URL('../../', import.meta.url))

export function selectScript(ticket, script, sha, directory = root) {
  if (typeof ticket !== 'string' || ticket !== ticket.trim() || !ticketPattern.test(ticket) || typeof sha !== 'string' || sha.length !== 40 || !/^[a-fA-F0-9]{40}$/.test(sha)) throw new Error('Invalid ticket or deployment SHA')
  if (script !== `e2e/live-qa/${ticket}.spec.ts`) throw new Error('Invalid script path')
  const manifest = JSON.parse(readFileSync(path.join(directory, 'scripts/live-qa/allowed-scripts.json'), 'utf8'))
  const entry = manifest[script]
  if (!entry || entry.ticket !== ticket || !Array.isArray(entry.boardIds) || !entry.boardIds.every(id => Number.isSafeInteger(id) && id > 0)) throw new Error('Script not approved')
  const boundary = path.join(realpathSync(directory), 'e2e/live-qa') + path.sep
  const resolved = realpathSync(path.join(directory, script))
  if (!resolved.startsWith(boundary) || !statSync(resolved).isFile()) throw new Error('Script escaped its directory')
  return { ...entry, script: resolved }
}

export function allowsRequest(method, address, body, boardIds) {
  try {
    const url = new URL(address)
    if (method === 'GET') return url.protocol === 'https:'
    if (url.origin !== baseURL) return false
    const ids = []
    for (const [key, value] of url.searchParams) {
      if (/^(projectId|boardId|project_id|board_id)$/.test(key)) ids.push(Number(value))
    }
    for (const match of url.pathname.matchAll(/\/(?:project-|projects\/|boards\/)([1-9][0-9]*)(?=\/|$)/g)) ids.push(Number(match[1]))
    const visit = value => {
      if (!value || typeof value !== 'object') return
      for (const [key, item] of Object.entries(value)) {
        if (/^(projectId|boardId|project_id|board_id)$/.test(key)) ids.push(Number(item))
        else if (item && typeof item === 'object') visit(item)
      }
    }
    if (body) visit(JSON.parse(body))
    return ids.length > 0 && ids.every(id => boardIds.includes(id))
  } catch {
    return false
  }
}

export async function doctor(sha, fetcher = fetch) {
  const get = async url => {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'hypertask-live-qa' } })
    if (!response.ok || response.headers.get('x-vercel-mitigated') === 'challenge') throw new Error('Doctor unavailable')
    return response.json()
  }
  const version = await get(`${baseURL}/api/version`)
  if (version.buildId !== sha) throw new Error('Deployed SHA mismatch')
  const deployments = await get(`https://api.github.com/repos/hypertask-ai/hypertask/deployments?environment=Production&sha=${sha}&per_page=100`)
  const deployment = deployments.find(item => item.sha === sha && item.environment === 'Production')
  if (!deployment || !Number.isSafeInteger(deployment.id)) throw new Error('Production deployment unavailable')
  const statuses = await get(`https://api.github.com/repos/hypertask-ai/hypertask/deployments/${deployment.id}/statuses`)
  if (statuses[0]?.state !== 'success') throw new Error('Production deployment not successful')
}

export function playwrightArgs(script) {
  return ['test', '--config', 'playwright.config.live-qa.ts', script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$']
}

async function main() {
  const mode = process.argv[2]
  if (!['validate', 'run'].includes(mode) || process.argv.length !== 3) throw new Error('Invalid mode')
  const entry = selectScript(process.env.LIVE_QA_TICKET, process.env.LIVE_QA_SCRIPT, process.env.LIVE_QA_EXPECTED_SHA)
  await doctor(process.env.LIVE_QA_EXPECTED_SHA)
  if (mode === 'validate') return
  const state = path.join(process.env.RUNNER_TEMP, 'live-qa-private/state.json')
  try {
    if ((statSync(state).mode & 0o777) !== 0o600) throw new Error('Private session permissions required')
    const keys = ['PATH', 'HOME', 'CI', 'RUNNER_TEMP', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'LIVE_QA_TICKET', 'LIVE_QA_SCRIPT', 'LIVE_QA_EXPECTED_SHA']
    const env = Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), ...playwrightArgs(entry.script)], {
      cwd: root, env, shell: false, stdio: 'ignore', timeout: 12 * 60_000,
    })
    await doctor(process.env.LIVE_QA_EXPECTED_SHA)
    if (result.error || result.status !== 0) throw new Error('QA did not pass')
  } finally {
    rmSync(path.dirname(state), { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('FAIL/UNREACHABLE: live QA validation, deployment doctor or reviewed test failed\n')
    process.exitCode = 1
  })
}
