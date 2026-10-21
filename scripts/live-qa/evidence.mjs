import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectScript } from './run.mjs'

export function validateRecipient(text) {
  const recipient = text.trim()
  if (!/^age1[0-9a-z]{58}$/.test(recipient) || recipient.includes('REPLACE')) throw new Error('Evidence recipient is not configured')
  return recipient
}

export function collectEvidence(results, evidence, outcome, metadata) {
  rmSync(evidence, { recursive: true, force: true })
  mkdirSync(evidence, { recursive: true, mode: 0o700 })
  const projects = new Set()
  let count = 0
  let total = 0
  const walk = directory => {
    for (const name of readdirSync(directory)) {
      const source = path.join(directory, name)
      const info = lstatSync(source)
      if (info.isSymbolicLink()) throw new Error('Evidence symlink refused')
      if (info.isDirectory()) { walk(source); continue }
      if (!info.isFile() || !/\.(png|webm)$/.test(name)) continue
      total += info.size
      if (++count > 200 || info.size > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new Error('Evidence budget exceeded')
      const extension = path.extname(name)
      const bytes = readFileSync(source)
      const signature = extension === '.png' ? '89504e470d0a1a0a' : '1a45dfa3'
      if (!bytes.subarray(0, signature.length / 2).equals(Buffer.from(signature, 'hex'))) throw new Error('Invalid media')
      const project = ['desktop', 'phone'].find(item => path.relative(results, source).split(path.sep)[0].endsWith(`-${item}`))
      if (project) projects.add(`${project}${extension}`)
      copyFileSync(source, path.join(evidence, `capture-${count}${extension}`))
    }
  }
  if (existsSync(results)) {
    if (!lstatSync(results).isDirectory() || lstatSync(results).isSymbolicLink()) throw new Error('Invalid results directory')
    walk(results)
  }
  const complete = ['desktop.png', 'desktop.webm', 'phone.png', 'phone.webm'].every(item => projects.has(item))
  if (outcome === 'success' && !complete) throw new Error('Missing required media')
  const verdict = outcome === 'success' ? 'PASS' : 'FAIL/UNREACHABLE'
  writeFileSync(path.join(evidence, 'metadata.json'), JSON.stringify({ ...metadata, account: 985, verdict, mediaFiles: count, complete }, null, 2), { mode: 0o600 })
  writeFileSync(path.join(evidence, 'proof.md'), `# ${metadata.ticket} automated capture\n\nCode: ${metadata.codeSha}\nDeploy: ${metadata.deploySha}\nAccount: 985 (QA)\nRun: ${metadata.runId}/${metadata.attempt}\n\n## Cases\n- ${verdict}: reviewed script ${metadata.script}; inspect media and apply the feature-map checklist before a final QA verdict.\n`, { mode: 0o600 })
  return count
}

function main() {
  process.umask(0o077)
  const mode = process.argv[2]
  if (!['validate', 'encrypt'].includes(mode) || process.argv.length !== 3) throw new Error('Invalid mode')
  selectScript(process.env.LIVE_QA_TICKET, process.env.LIVE_QA_SCRIPT, process.env.LIVE_QA_EXPECTED_SHA)
  const recipient = validateRecipient(readFileSync(new URL('./evidence-recipient.txt', import.meta.url), 'utf8'))
  if (mode === 'validate') return
  if (!['success', 'failure'].includes(process.env.LIVE_QA_OUTCOME)) throw new Error('Invalid outcome')
  const temp = process.env.RUNNER_TEMP
  const evidence = path.join(temp, 'live-qa-evidence')
  const archive = path.join(temp, 'live-qa-evidence.tar')
  const encrypted = `${archive}.age`
  rmSync(encrypted, { force: true })
  try {
    collectEvidence(path.join(temp, 'live-qa-results'), evidence, process.env.LIVE_QA_OUTCOME, {
      ticket: process.env.LIVE_QA_TICKET, script: process.env.LIVE_QA_SCRIPT,
      codeSha: process.env.GITHUB_SHA, deploySha: process.env.LIVE_QA_EXPECTED_SHA,
      runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    })
    for (const [command, args] of [
      ['tar', ['-cf', archive, '-C', evidence, '.']],
      ['age', ['--encrypt', '--recipient', recipient, '--output', encrypted, archive]],
    ]) {
      const result = spawnSync(command, args, { shell: false, stdio: 'ignore', timeout: 60_000 })
      if (result.error || result.status !== 0) throw new Error('Evidence encryption failed')
    }
  } catch {
    rmSync(encrypted, { force: true })
    throw new Error('Evidence encryption failed')
  } finally {
    rmSync(archive, { force: true })
    rmSync(evidence, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch {
    process.stderr.write('FAIL: evidence validation or encryption failed; no plaintext upload permitted\n')
    process.exitCode = 1
  }
}
