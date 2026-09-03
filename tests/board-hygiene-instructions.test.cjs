const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')

const instructions = join(
  process.cwd(),
  'scripts/vps-background-services/config/board-hygiene/INSTRUCTIONS.md',
)
const executable = join(
  process.cwd(),
  'scripts/vps-background-services/bin/board-hygiene',
)

test('board hygiene retains the canonical classification contract', async () => {
  const prompt = await readFile(instructions, 'utf8')

  for (const kind of ['Bug', 'FEATURE', 'IMPROVEMENT', 'SKIP']) {
    assert.match(prompt, new RegExp(`^${kind}$`, 'm'))
  }
  assert.ok(prompt.endsWith(`## Output

One line per ticket, exactly \`TICKET=KIND\`, nothing else. No preamble, no
explanation, no blank lines, no markdown.

HTPR-1234=Bug
HTPR-1235=FEATURE
`))
})

test('board hygiene never uses replacement label writes', async () => {
  const script = await readFile(executable, 'utf8')

  assert.match(script, /skip_if_labels_present/)
  assert.doesNotMatch(script, /--labels\b/)
})
