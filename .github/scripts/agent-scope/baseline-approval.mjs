#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const TICKET_URL = /^https:\/\/app\.hypertask\.ai\/detail\/project-\d+\/\d+$/
export const WATCHED = {
  '.github/scripts/agent-scope/agent-scope-baseline.json': 'debt',
  '.github/scripts/agent-scope/agent-scope-exceptions.json': 'exception',
}
const key = entry => JSON.stringify([entry.path, entry.call, entry.occurrence])
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))

export function checkApproval(files, prBody) {
  const failures = []
  const approvals = new Set()
  for (const { file, base, head } of files) {
    const kind = WATCHED[file]
    if (!kind || base === null) continue
    const before = new Map(JSON.parse(base).map(entry => [key(entry), entry]))
    const after = head === null ? [] : JSON.parse(head)
    for (const entry of after) {
      const identity = key(entry)
      if (before.has(identity) && canonical(before.get(identity)) === canonical(entry)) continue
      const url = entry.approvedIn
      if (typeof url !== 'string' || !TICKET_URL.test(url)) {
        failures.push(`${file}: ${identity} changed without a valid approvedIn full ticket URL.`)
        continue
      }
      const line = `Agent scope ${kind} approved: ${url}`
      if (!String(prBody ?? '').split(/\r?\n/).some(text => text.trim() === line)) {
        failures.push(`The PR body must contain the line: ${line}`)
      }
      approvals.add(line)
    }
  }
  return { failures, approvals: [...approvals] }
}

function gitShow(sha, file) {
  const paths = execFileSync('git', ['ls-tree', '--name-only', sha, '--', file], { encoding: 'utf8' })
  if (!paths.trim()) return null
  return execFileSync('git', ['show', `${sha}:${file}`], { encoding: 'utf8' })
}

function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  if (!event.pull_request) {
    console.log('Agent scope approval: not a pull request.')
    return 0
  }
  const baseSha = process.env.BASE_SHA || event.pull_request.base?.sha
  if (!/^[0-9a-f]{40}$/.test(baseSha ?? '')) throw new Error('Missing valid BASE_SHA')
  const files = Object.keys(WATCHED).map(file => ({
    file,
    base: gitShow(baseSha, file),
    head: existsSync(file) ? readFileSync(file, 'utf8') : null,
  }))
  const { failures, approvals } = checkApproval(files, event.pull_request.body)
  for (const failure of failures) console.error(`::error::${failure}`)
  for (const approval of approvals) console.log(approval)
  if (!failures.length) console.log('Agent scope approval passed.')
  return failures.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main())
