const { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const FEATURE_MAP = /^\.claude\/skills\/verify-qa\/reference\/feature-map\/[a-z0-9-]+\.md$/
const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-qa-run-[0-9]+$/

function loopback(raw) {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

function writeDecision(dest, body) {
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, 'decision.json'), `${JSON.stringify(body, null, 2)}\n`)
}

function safeStepName(name) {
  return String(name || 'drive').replace(/->/g, ' to ').replace(/[\r\n]/g, ' ').trim() || 'drive'
}

function writeRecord({ out, dest, head, root, run }) {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  if (!/^[a-f0-9]{40}$/.test(head || '')) {
    writeDecision(dest, { verdict: 'FAIL', reason: 'missing head sha', head: head || '', source: 'seeded' })
    return { verdict: 'FAIL', reason: 'missing head sha' }
  }
  const runId = run || `${new Date().toISOString().slice(0, 10)}-qa-run-1`
  if (!RUN_ID.test(runId)) {
    writeDecision(dest, { verdict: 'FAIL', reason: 'bad run id', head, source: 'seeded' })
    return { verdict: 'FAIL', reason: 'bad run id' }
  }
  let result
  try {
    result = JSON.parse(readFileSync(path.join(out, 'result.json'), 'utf8'))
  } catch {
    writeDecision(dest, { verdict: 'ABSENT', reason: 'no seeded run', head, source: 'seeded' })
    return { verdict: 'ABSENT', reason: 'no seeded run' }
  }
  const base = {
    verdict: result.verdict || 'FAIL',
    reason: result.failure || result.selectionReason || 'no passing drive',
    head,
    featureMap: result.featureMap || null,
    source: 'seeded',
    base: result.base || '',
  }
  const steps = Array.isArray(result.steps) ? result.steps : []
  if (result.verdict !== 'PASS' || steps.some((step) => !step.pass)) {
    writeDecision(dest, { ...base, verdict: 'FAIL', reason: base.reason || 'drive listed a failed step' })
    return { verdict: 'FAIL', reason: base.reason || 'drive listed a failed step' }
  }
  if (!FEATURE_MAP.test(result.featureMap || '') || !existsSync(path.join(root, result.featureMap))) {
    writeDecision(dest, { ...base, verdict: 'FAIL', reason: 'drive did not name a feature-map page' })
    return { verdict: 'FAIL', reason: 'drive did not name a feature-map page' }
  }
  if (!loopback(result.base)) {
    writeDecision(dest, { ...base, verdict: 'FAIL', reason: 'drive was not the seeded loopback app' })
    return { verdict: 'FAIL', reason: 'drive was not the seeded loopback app' }
  }
  const runDir = path.join(dest, runId)
  mkdirSync(runDir, { recursive: true })
  const copied = []
  for (const rel of Array.isArray(result.screenshots) ? result.screenshots : []) {
    if (typeof rel !== 'string' || rel.includes('..') || path.isAbsolute(rel) || !rel.endsWith('.png')) continue
    const from = path.resolve(out, rel)
    const relCheck = path.relative(out, from)
    if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) continue
    if (!existsSync(from) || statSync(from).size === 0) continue
    const name = `${String(copied.length + 1).padStart(2, '0')}.png`
    copyFileSync(from, path.join(runDir, name))
    copied.push(name)
  }
  if (!copied.length) {
    writeDecision(dest, { ...base, verdict: 'FAIL', reason: 'drive produced no screenshot' })
    return { verdict: 'FAIL', reason: 'drive produced no screenshot' }
  }
  const cases = (steps.length ? steps : [{ name: 'drive', pass: true }]).map((step, index) =>
    `- PASS: ${safeStepName(step.name)} -> ${copied[Math.min(index, copied.length - 1)]}`)
  writeFileSync(path.join(dest, 'proof.md'), [
    `Feature map: ${result.featureMap}`,
    'Source: seeded',
    `Head: ${head}`,
    `Run: ${runId}`,
    '',
    '## Cases',
    ...cases,
    '',
  ].join('\n'))
  writeDecision(dest, { ...base, verdict: 'PASS', reason: null })
  return { verdict: 'PASS', featureMap: result.featureMap }
}

function main() {
  writeRecord({
    out: path.resolve(process.env.VERIFY_QA_OUT || 'verify-qa-premerge'),
    dest: path.resolve(process.env.DRIVEN_PROOF_OUT || 'driven-proof-record'),
    head: process.env.HEAD_SHA || '',
    root: process.cwd(),
    run: process.env.DRIVEN_PROOF_RUN,
  })
}

if (require.main === module) main()

module.exports = { writeRecord, loopback }
