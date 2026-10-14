const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('legacy SSE stream ends cleanly before the Vercel function limit', () => {
  const maxDuration = Number(read('src/app/sse/route.ts').match(/export const maxDuration = (\d+)/)[1])
  const legacy = read('src/lib/mcp-server/legacy-sse.ts')
  const lifetime = legacy.match(/export const LEGACY_SSE_LIFETIME_MS = (\d+) \* 1000/)
  assert.ok(lifetime, 'LEGACY_SSE_LIFETIME_MS is declared in seconds')
  const seconds = Number(lifetime[1])
  assert.ok(seconds <= maxDuration - 15, `stream lifetime ${seconds}s leaves under 15s before maxDuration ${maxDuration}s`)
  assert.match(legacy, /setTimeout\(\(\) => stream\.end\(\), LEGACY_SSE_LIFETIME_MS\)/,
    'the timer ends the stream instead of destroying it, so the response finishes normally')
})
