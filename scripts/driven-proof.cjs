const { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const path = require('node:path')

function exemptKind(file) {
  if (typeof file !== 'string' || !file || /[\r\n]/.test(file)) return null
  if (file.startsWith('docs/') || (file.endsWith('.md') && !file.startsWith('src/'))) return 'docs'
  if (file.startsWith('tests/')) return 'test'
  if (['.github/', 'scripts/', '.claude/', 'skills/', '.agents/'].some((prefix) => file.startsWith(prefix))) return 'ci'
  return null
}

function classify(files) {
  if (!Array.isArray(files) || !files.length) return { exempt: false, reason: 'empty or unknown diff' }
  const kinds = files.map(exemptKind)
  return kinds.every(Boolean) ? { exempt: true, kinds: [...new Set(kinds)].sort() } : { exempt: false, reason: 'screen or app change' }
}

async function acceptRecord(dir, head, root, files) {
  const { assertLoopback, selectJourney } = await import('../.github/scripts/verify-qa-premerge.mjs')
  try {
    const record = JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8'))
    if (record.verdict !== 'PASS') return { ok: false, reason: `drive ${record.verdict || 'failed'}` }
    if (!/^[a-f0-9]{40}$/.test(head || '') || record.head !== head) return { ok: false, reason: 'proof head does not match the pull request' }
    assertLoopback(record.base)
    const runtimeFiles = files.filter((file) => !exemptKind(file))
    const choice = selectJourney(runtimeFiles)
    if (!choice.journey || record.featureMap !== choice.featureMap || !existsSync(path.join(root, choice.featureMap)) ||
        runtimeFiles.some((file) => selectJourney([file]).featureMap !== record.featureMap)) {
      return { ok: false, reason: 'proof does not cover the changed feature' }
    }
    if (!Array.isArray(record.steps) || !record.steps.length || record.steps.some((step) => step.pass !== true)) {
      return { ok: false, reason: 'proof has no passing cases or contains a failure' }
    }
    if (!Array.isArray(record.screenshots) || !record.screenshots.length) return { ok: false, reason: 'proof has no screenshot' }
    for (const file of record.screenshots) {
      if (typeof file !== 'string' || file.includes('..') || path.isAbsolute(file) || !file.endsWith('.png')) {
        return { ok: false, reason: 'invalid screenshot path' }
      }
      const png = readFileSync(path.join(dir, file))
      if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { ok: false, reason: 'invalid screenshot' }
    }
    return { ok: true, featureMap: record.featureMap }
  } catch {
    return { ok: false, reason: 'missing or invalid seeded proof record' }
  }
}

async function decide({ files, recordDir, head, root = process.cwd() }) {
  const scope = classify(files)
  if (scope.exempt) return { verdict: 'PASS', detail: `exempt: ${scope.kinds.join(', ')}` }
  if (scope.reason === 'empty or unknown diff') return { verdict: 'FAIL', detail: scope.reason }
  const accepted = await acceptRecord(recordDir, head, root, files)
  return accepted.ok ? { verdict: 'PASS', detail: `seeded ${accepted.featureMap}` } : { verdict: 'FAIL', detail: accepted.reason }
}

function controlNeeded(files) {
  return Array.isArray(files) && files.some((file) => file === 'scripts/driven-proof.cjs')
}

function pullRequestFiles(base, head) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'driven-proof-scope-'))
  try {
    const output = path.join(tmp, 'output')
    writeFileSync(output, '')
    const child = spawnSync(process.execPath, [path.join(__dirname, '../.github/scripts/ci-change-scope.cjs')], {
      encoding: 'utf8',
      env: { ...process.env, SCOPE_EVENT_NAME: 'pull_request', BASE_SHA: base || '', HEAD_SHA: head || '', RUNNER_TEMP: tmp, GITHUB_OUTPUT: output },
    })
    if (child.status !== 0) return []
    return readFileSync(path.join(tmp, 'changed-files.txt'), 'utf8').split('\n').filter(Boolean)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  const head = process.env.HEAD_SHA || ''
  const files = process.argv.includes('--control') ? ['src/pages/api/notifications/getAll.ts'] : pullRequestFiles(process.env.BASE_SHA, head)
  if (process.env.GITHUB_OUTPUT && !process.argv.includes('--control')) {
    const control = controlNeeded(files)
    appendFileSync(process.env.GITHUB_OUTPUT, `control_needed=${control}\n`)
  }
  const result = await decide({ files, recordDir: process.env.DRIVEN_PROOF_RECORD, head })
  const line = `driven-proof ${result.verdict}: ${result.detail}`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
  process.exitCode = result.verdict === 'PASS' ? 0 : 1
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { exemptKind, classify, decide, acceptRecord, controlNeeded }
