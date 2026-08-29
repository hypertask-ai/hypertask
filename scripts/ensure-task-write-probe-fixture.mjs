// HTPR-5467 — provision the task-write probe fixture for a health identity.
//
// The /api/ops/task-write-probe endpoint never creates data; it reports
// inconclusive until this has been run once for the account behind the health
// check's bearer token (HYPERTASK_MCP_TOKEN in prod-health.yml).
//
//   node scripts/ensure-task-write-probe-fixture.mjs <userId>
//
// Idempotent: re-running returns the existing fixture. It commits one archived
// project and one task in it; delete either and the probe goes inconclusive
// until this is run again.

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const userId = Number(process.argv[2])
if (!Number.isInteger(userId) || userId < 1) {
  console.error('Usage: node scripts/ensure-task-write-probe-fixture.mjs <userId>')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const jiti = createRequire(import.meta.url)('jiti')(import.meta.url, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { ensureTaskWriteProbeFixture, probeProjectName } = jiti(
  path.join(root, 'src/lib/taskCardActions/writeProbe.ts'),
)

try {
  const task = await ensureTaskWriteProbeFixture(userId)
  console.log(`Probe fixture ready: task ${task.id} on board ${probeProjectName(userId)} (user ${userId}).`)
  process.exit(0)
} catch (err) {
  console.error(`Could not provision the probe fixture: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
