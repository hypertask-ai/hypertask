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
