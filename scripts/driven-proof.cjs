const { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const path = require('node:path')

const FEATURE_MAP = /^\.claude\/skills\/verify-qa\/reference\/feature-map\/[a-z0-9-]+\.md$/
const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-qa-run-[0-9]+$/
const PASS_LINE = /^\s*- PASS: (.+?) -> ([A-Za-z0-9._/-]+)\s*$/

function exemptKind(file) {
  if (typeof file !== 'string' || file.length === 0 || /[\r\n]/.test(file)) return null
  if (file.startsWith('docs/') || (file.endsWith('.md') && !file.startsWith('src/'))) return 'docs'
  if (file.startsWith('tests/')) return 'test'
  if (file.startsWith('.github/') || file.startsWith('scripts/') || file.startsWith('.claude/') ||
    file.startsWith('skills/') || file.startsWith('.agents/')) return 'ci'
  return null
}

function classify(files) {
  if (!Array.isArray(files) || files.length === 0) return { exempt: false, reason: 'empty or unknown diff' }
  const kinds = new Set()
  for (const file of files) {
    const kind = exemptKind(file)
    if (!kind) return { exempt: false, reason: 'screen or app change' }
    kinds.add(kind)
  }
  return { exempt: true, kinds: [...kinds].sort() }
}

function loopback(raw) {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

function productionHost(raw) {
  try {
    const host = new URL(raw).hostname
    return host === 'hypertask.ai' || host.endsWith('.hypertask.ai')
  } catch {
    return true
  }
}

function readDecision(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'decision.json'), 'utf8'))
  } catch {
    return null
  }
}

function absentReason(dir) {
  const decision = readDecision(dir)
  if (decision && decision.verdict && decision.verdict !== 'PASS') {
    const why = String(decision.reason || decision.verdict).split('\n')[0]
    return `no proof record (${decision.verdict}: ${why})`
  }
  return 'no proof record'
}

function acceptRecord(dir, head, root) {
  if (!dir || !existsSync(path.join(dir, 'proof.md'))) return { ok: false, reason: absentReason(dir) }
  const decision = readDecision(dir)
  if (!decision || decision.verdict !== 'PASS') return { ok: false, reason: absentReason(dir) }
  const text = readFileSync(path.join(dir, 'proof.md'), 'utf8')
  const featureMap = text.match(/^Feature map: (\S+)\s*$/m)?.[1]
  const source = text.match(/^Source: (seeded|preview)\s*$/m)?.[1]
  const proofHead = text.match(/^Head: ([a-f0-9]{40})\s*$/m)?.[1]
  const run = text.match(/^Run: (\S+)\s*$/m)?.[1]
  if (!featureMap || !FEATURE_MAP.test(featureMap) || !existsSync(path.join(root, featureMap))) {
    return { ok: false, reason: 'proof record is incomplete' }
  }
  if (!source || !proofHead || !run || !RUN_ID.test(run)) return { ok: false, reason: 'proof record is incomplete' }
  if (proofHead !== head || decision.head !== head) return { ok: false, reason: 'proof head does not match the pull request' }
  if (decision.featureMap !== featureMap || decision.source !== source) return { ok: false, reason: 'proof record is incomplete' }
  if (!text.includes('\n## Cases\n') && !text.startsWith('## Cases\n')) return { ok: false, reason: 'proof record is incomplete' }
  if (/^\s*- FAIL:/m.test(text)) return { ok: false, reason: 'proof record is incomplete' }
  if (source === 'seeded' && !loopback(decision.base)) return { ok: false, reason: 'proof record is incomplete' }
  if (source === 'preview' && (loopback(decision.base) || productionHost(decision.base))) {
    return { ok: false, reason: 'proof drives production' }
  }
  const passes = []
  for (const line of text.split('\n')) {
    const match = line.match(PASS_LINE)
    if (match) passes.push(match[2])
  }
  if (!passes.length) return { ok: false, reason: 'proof record is incomplete' }
  const runDir = path.join(dir, run)
  for (const file of passes) {
    if (file.includes('..')) return { ok: false, reason: 'proof record is incomplete' }
    const target = path.resolve(runDir, file)
    const rel = path.relative(runDir, target)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !existsSync(target) || statSync(target).size === 0) {
      return { ok: false, reason: 'proof record is incomplete' }
    }
  }
  let png = false
  try {
    png = readdirSync(runDir).some((name) => name.endsWith('.png') && statSync(path.join(runDir, name)).size > 0)
  } catch {
    png = false
  }
  if (!png) return { ok: false, reason: 'proof record is incomplete' }
  return { ok: true, featureMap, source }
}

function decide({ files, recordDir, head, root }) {
  const scope = classify(files)
  if (scope.exempt) return { verdict: 'PASS', detail: `exempt: ${scope.kinds.join(', ')}` }
  if (scope.reason === 'empty or unknown diff' || !/^[a-f0-9]{40}$/.test(head || '')) {
    return { verdict: 'FAIL', detail: 'empty or unknown diff' }
  }
  const accepted = acceptRecord(recordDir, head, root || process.cwd())
  if (!accepted.ok) return { verdict: 'FAIL', detail: accepted.reason }
  return { verdict: 'PASS', detail: `${accepted.source} ${accepted.featureMap}` }
}

function report(result) {
  const line = `driven-proof ${result.verdict}: ${result.detail}`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
  return result.verdict === 'PASS' ? 0 : 1
}

function pullRequestFiles(base, head) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'driven-proof-scope-'))
  try {
    const output = path.join(tmp, 'output')
    writeFileSync(output, '')
    const child = spawnSync(process.execPath, [path.join(__dirname, '../.github/scripts/ci-change-scope.cjs')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SCOPE_EVENT_NAME: 'pull_request',
        BASE_SHA: base || '',
        HEAD_SHA: head || '',
        RUNNER_TEMP: tmp,
        GITHUB_OUTPUT: output,
      },
    })
    if (child.status !== 0) return []
    return readFileSync(path.join(tmp, 'changed-files.txt'), 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function main() {
  const head = process.env.HEAD_SHA || ''
  return report(decide({
    files: pullRequestFiles(process.env.BASE_SHA, head),
    recordDir: process.env.DRIVEN_PROOF_RECORD,
    head,
    root: process.cwd(),
  }))
}

if (require.main === module) process.exit(main())

module.exports = { classify, decide, exemptKind, acceptRecord }
