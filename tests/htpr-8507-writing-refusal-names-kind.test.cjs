const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting } = load('src/lib/agents/writing.ts', {})

function refusal(text) {
  try {
    assertAgentWriting('agent-1', { text })
  } catch (error) {
    return error
  }
  throw new Error('the text was accepted')
}

test('a refused file path is named in full and called a file path', () => {
  const error = refusal('Blocker: the run script ./scripts/strix-file-tickets.py failed.')
  assert.match(error.message, /Technical details belong in the agent log: a file path \("\.\/scripts\/strix-file-tickets\.py"\)\./)
})

test('a value that ends a sentence is quoted without the full stop', () => {
  assert.match(refusal('Blocker: the run script ./scripts/strix-file-tickets.py.').message, /: a file path \("\.\/scripts\/strix-file-tickets\.py"\)\./)
  assert.match(refusal('The build failed on the release commit 9e5741ca.').message, /: a build or commit id \("9e5741ca"\)\./)
})

test('a home directory path is called a file path', () => {
  assert.match(refusal('Blocker: ~/scripts/run.sh stopped early.').message, /: a file path \("~\/scripts\/run\.sh"\)\./)
})

test('a refused file name is called a file name', () => {
  assert.match(refusal('Please check writing.ts again.').message, /: a file name \("writing\.ts"\)\./)
})

test('other refused values carry their own plain name', () => {
  assert.match(refusal('Please put `npm run build` here.').message, /: a backticked value \("`npm run build`"\)\./)
  assert.match(refusal('Please put exit code here.').message, /: a log word \("exit code"\)\./)
  assert.match(refusal('Run it without --force first.').message, /: a command flag \("--force"\)\./)
  assert.match(refusal('The helper resolve_flag_state returned nothing.').message, /: a code name \("resolve_flag_state"\)\./)
})

test('a product name the ticket itself uses is accepted', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: 'PostHog shows more traffic once the flag is on.' }))
})

test('a link instead of a raw value is accepted', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', {
    text: 'The run failed. <a href="https://vercel.com/hypertask/deploys/dpl_9e5741ca">The failing run</a> has the details.',
  }))
})
