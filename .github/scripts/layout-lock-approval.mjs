#!/usr/bin/env node
// YPER4-252: a layout lock baseline or ratchet may only change with the ticket where Valentin approved it.
// Every changed unit needs an `approvedIn` full ticket URL, and the PR body needs the line
// `Layout change approved: <that URL>`. Run in the browser-smoke job against the PR base commit.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

export const TICKET_URL = /^https:\/\/app\.hypertask\.ai\/detail\/project-\d+\/\d+$/
const BODY_LINE = /^[ \t]*Layout change approved:[ \t]*(https:\/\/app\.hypertask\.ai\/detail\/project-\d+\/\d+)[ \t]*$/gm

const entries = (keyOf) => ({
  kind: 'entries',
  units: (json) => Object.fromEntries((json ?? []).map(entry => [keyOf(entry), entry])),
  approvedIn: (json, key, unit) => unit?.approvedIn,
  removalNeedsApproval: false,
})
const mapped = (units) => ({
  kind: 'map',
  units,
  approvedIn: (json, key) => json?.approvedIn?.[key],
  removalNeedsApproval: true,
})

export const WATCHED = {
  'e2e/smoke/layout-lock.baseline.json': mapped(json => Object.fromEntries(Object.entries(json?.viewports ?? {}).flatMap(([device, value]) => [
    [`viewport/${device}`, value.viewport],
    ...Object.entries(value.screens ?? {}).map(([screen, landmarks]) => [`${screen}/${device}`, landmarks]),
  ]))),
  'e2e/smoke/layout-lock-matrix.baseline.json': mapped(json => json?.pages ?? {}),
  'e2e/smoke/layout-lock.flag-changes.json': entries(entry => `${entry.flag}/${entry.screen}`),
  'e2e/smoke/layout-lock-matrix.flag-changes.json': entries(entry => `${entry.flag}/${entry.page}`),
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** files: [{ file, base, head }] with raw JSON text (null when the file does not exist). */
export function checkApproval(files, prBody) {
  const failures = []
  const approvals = new Set()
  const bodyUrls = new Set([...String(prBody ?? '').matchAll(BODY_LINE)].map(match => match[1]))
  for (const { file, base, head } of files) {
    const watch = WATCHED[file]
    if (!watch) continue
    const baseJson = base ? JSON.parse(base) : null
    const headJson = head ? JSON.parse(head) : null
    const baseUnits = watch.units(baseJson)
    const headUnits = watch.units(headJson)
    for (const key of new Set([...Object.keys(baseUnits), ...Object.keys(headUnits)])) {
      if (same(baseUnits[key], headUnits[key])) continue
      const removed = !(key in headUnits)
      if (removed && !watch.removalNeedsApproval) continue
      const url = watch.approvedIn(headJson, key, headUnits[key])
      if (typeof url !== 'string' || !TICKET_URL.test(url)) {
        failures.push(`${file}: "${key}" ${removed ? 'was removed' : 'changed'} without a valid approvedIn. Add approvedIn for "${key}" with the full URL of the ticket where Valentin approved this layout change (https://app.hypertask.ai/detail/project-<n>/<m>).`)
        continue
      }
      approvals.add(url)
    }
  }
  for (const url of approvals) {
    if (!bodyUrls.has(url)) failures.push(`The PR body must contain the line: Layout change approved: ${url}`)
  }
  return { failures, approvals: [...approvals] }
}

function gitShow(sha, file) {
  try {
    return execFileSync('git', ['show', `${sha}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  const event = eventPath && existsSync(eventPath) ? JSON.parse(readFileSync(eventPath, 'utf8')) : {}
  const baseSha = process.env.BASE_SHA || event.pull_request?.base?.sha
  if (!event.pull_request || !baseSha) {
    console.log('Layout approval: not a pull request, nothing to compare.')
    return 0
  }
  const files = Object.keys(WATCHED).map(file => ({
    file,
    base: gitShow(baseSha, file),
    head: existsSync(file) ? readFileSync(file, 'utf8') : null,
  }))
  const { failures, approvals } = checkApproval(files, event.pull_request.body)
  for (const failure of failures) console.error(`::error::${failure}`)
  for (const url of approvals) console.log(`Layout change approved in ${url}`)
  if (!failures.length && !approvals.length) console.log('Layout approval: no baseline or ratchet changes.')
  return failures.length ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main())
