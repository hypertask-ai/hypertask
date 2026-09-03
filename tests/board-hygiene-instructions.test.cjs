const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')

const instructions = join(
  process.cwd(),
  'scripts/vps-background-services/config/board-hygiene/INSTRUCTIONS.md',
)

test('board hygiene retains the canonical classification contract', async () => {
  const prompt = await readFile(instructions, 'utf8')

  for (const kind of ['Bug', 'FEATURE', 'IMPROVEMENT', 'SKIP']) {
    assert.match(prompt, new RegExp(`^${kind}$`, 'm'))
  }
  assert.match(prompt, /exactly `TICKET=KIND`/)
  assert.match(prompt, /^HTPR-1234=Bug$/m)
})
