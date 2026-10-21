import { rmSync } from 'node:fs'
import path from 'node:path'
import { renewQaSession } from '../../e2e/smoke/lib/qa-session'

process.umask(0o077)
const state = path.join(process.env.RUNNER_TEMP!, 'live-qa-private', 'state.json')

renewQaSession('https://app.hypertask.ai', state).catch(() => {
  rmSync(path.dirname(state), { recursive: true, force: true })
  process.stderr.write('UNREACHABLE: QA login or user 985 verification failed\n')
  process.exitCode = 1
})
