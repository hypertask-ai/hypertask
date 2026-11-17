#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectJourney } from './verify-qa-premerge.mjs'

export const RECORDED_ARTIFACTS = {
  'inbox.md': 'verify-qa-video-inbox',
}

const RECORDING = /\.(webm|zip)$/i

export function changedPages(files) {
  const pages = new Set()
  for (const file of Array.isArray(files) ? files : []) {
    if (typeof file !== 'string' || file.length === 0) continue
    const choice = selectJourney([file])
    if (choice.matchedPage) pages.add(choice.matchedPage)
  }
  return [...pages].sort()
}

export function recordingsOf(artifact) {
  const files = Array.isArray(artifact.files) ? artifact.files : []
  return files.filter((file) => typeof file === 'string' && RECORDING.test(file))
}

export function evaluate({ files, artifacts }) {
  const pages = changedPages(files)
  const gated = pages.filter((page) => Object.hasOwn(RECORDED_ARTIFACTS, page))
  const ungated = pages.filter((page) => !Object.hasOwn(RECORDED_ARTIFACTS, page))
  const missing = []
  const covered = []
  for (const page of gated) {
    const wanted = RECORDED_ARTIFACTS[page]
    const found = (Array.isArray(artifacts) ? artifacts : []).find((artifact) =>
      artifact && artifact.name === wanted && recordingsOf(artifact).length > 0)
    if (found) covered.push({ page, artifact: wanted })
    else missing.push({ page, artifact: wanted })
  }
  return { ok: missing.length === 0, pages, gated, ungated, missing, covered }
}

export function failureMessage(result, { pr = null, sha = null } = {}) {
  const where = pr ? `PR #${pr}` : sha ? `commit ${sha}` : 'this release'
  const named = result.missing.map((entry) => `${entry.page} (expected artifact ${entry.artifact})`).join(', ')
  return `Release evidence missing for changed feature area: ${named} on ${where}. Record the changed screen and upload the artifact before releasing.`
}

export function evidenceSha(merged, fallbackSha) {
  if (merged && merged.headSha) return merged.headSha
  return fallbackSha
}

export function listZipEntries(zipPath) {
  const listing = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
  if (listing.status !== 0) return []
  return listing.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
}

export function parseArgs(argv) {
  const args = { repo: process.env.GITHUB_REPOSITORY || '', pr: null, sha: null }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--repo' && value) { args.repo = value; index += 1 }
    else if (flag === '--pr' && value) { args.pr = Number(value); index += 1 }
    else if (flag === '--sha' && value) { args.sha = value; index += 1 }
  }
  return args
}

function gh(args, { allowFail = false } = {}) {
  const run = spawnSync('gh', args, { encoding: 'utf8', env: process.env })
  if (run.status !== 0) {
    if (allowFail) return null
    throw new Error(`gh ${args.join(' ')} failed: ${(run.stderr || '').trim().split('\n')[0]}`)
  }
  return run.stdout
}

function lines(args, options) {
  const out = gh(args, options)
  if (out === null) return []
  return out.split('\n').map((line) => line.trim()).filter(Boolean)
}

function ghJson(args, options) {
  const first = lines(args, options)[0]
  return first === undefined ? null : JSON.parse(first)
}

export function findMergedPr({ repo, sha }) {
  const pulls = ghJson(['api', `repos/${repo}/commits/${sha}/pulls`, '--jq', '[.[] | select(.merged_at != null)]'])
  const first = Array.isArray(pulls) ? pulls[0] : null
  if (!first) return null
  return { number: first.number, headSha: first.head && first.head.sha }
}

export function prFiles({ repo, pr }) {
  const out = gh(['api', '--paginate', `repos/${repo}/pulls/${pr}/files`, '--jq', '.[].filename'])
  return out.split('\n').map((line) => line.trim()).filter(Boolean)
}

export function prArtifacts({ repo, sha }) {
  const ids = lines(['api', '--paginate', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`, '--jq', '.workflow_runs[].id'])
  const artifacts = []
  for (const id of ids) {
    const listed = lines(['api', '--paginate', `repos/${repo}/actions/runs/${id}/artifacts`, '--jq', '.artifacts[] | {name: .name, id: .id}'], { allowFail: true })
    for (const row of listed) {
      const artifact = JSON.parse(row)
      artifacts.push({ name: artifact.name, files: artifactFiles({ repo, id: artifact.id }) })
    }
  }
  return artifacts
}

function artifactFiles({ repo, id }) {
  const dir = mkdtempSync(join(tmpdir(), 'release-evidence-'))
  const file = join(dir, 'artifact.zip')
  const output = openSync(file, 'w')
  let closed = false
  try {
    const download = spawnSync('gh', ['api', `repos/${repo}/actions/artifacts/${id}/zip`], {
      stdio: ['ignore', output, 'pipe'],
      env: process.env,
    })
    closeSync(output)
    closed = true
    if (download.status !== 0) return []
    return listZipEntries(file)
  } finally {
    if (!closed) closeSync(output)
    rmSync(dir, { recursive: true, force: true })
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.repo) throw new Error('release-evidence-gate needs --repo or GITHUB_REPOSITORY')
  let pr = args.pr
  let sha = args.sha
  if (!pr) {
    const merged = sha ? findMergedPr({ repo: args.repo, sha }) : null
    if (!merged) {
      console.log(`::warning::Release evidence gate skipped: no merged pull request for ${sha || 'this run'}. Direct pushes carry no PR evidence.`)
      return
    }
    pr = merged.number
    sha = evidenceSha(merged, sha)
  }
  if (!sha) {
    const pull = ghJson(['api', `repos/${args.repo}/pulls/${pr}`, '--jq', '{sha: .head.sha}'])
    sha = pull && pull.sha
  }
  if (!sha) throw new Error('release-evidence-gate needs the pull request head commit')
  const files = prFiles({ repo: args.repo, pr })
  const artifacts = prArtifacts({ repo: args.repo, sha })
  const result = evaluate({ files, artifacts })
  const summary = [
    `Changed feature areas: ${result.pages.join(', ') || 'none'}`,
    `Gated areas: ${result.gated.join(', ') || 'none'}`,
    `Areas without a recording rule yet: ${result.ungated.join(', ') || 'none'}`,
    `Recorded: ${result.covered.map((entry) => `${entry.page} (${entry.artifact})`).join(', ') || 'none'}`,
  ]
  for (const line of summary) console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const text = ['## Release evidence', '', ...summary.map((line) => `- ${line}`), ''].join('\n')
    spawnSync('bash', ['-c', 'cat >> "$GITHUB_STEP_SUMMARY"'], { input: text, encoding: 'utf8', env: process.env })
  }
  if (!result.ok) {
    console.log(`::error::${failureMessage(result, { pr, sha })}`)
    process.exitCode = 1
    return
  }
  console.log(`Release evidence ok for ${result.covered.length} recorded area(s).`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
