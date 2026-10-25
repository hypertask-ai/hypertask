import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { createJiti } from 'jiti'

const root = path.resolve(__dirname, '..')
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })
const helper = jiti(path.join(root, 'src/utils/controllers/turbopuffer/turbopufferHelper.ts')) as any

function stubEmbeddings() {
  const sent: string[][] = []
  const realFetch = globalThis.fetch
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY ||= 'test-only'
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { input } = JSON.parse(init.body)
    sent.push(input)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const data = input.map((text: string, index: number) => ({ index, embedding: [text.length] }))
    return new Response(JSON.stringify({ data }), { status: 200 })
  }) as any
  return { sent, restore: () => { globalThis.fetch = realFetch } }
}

test('two concurrent searches for the same query share one embedding call', async () => {
  const { sent, restore } = stubEmbeddings()
  try {
    const [a, b] = await Promise.all([helper.embedTexts(['same brief']), helper.embedTexts(['  same   brief ']) ])
    assert.equal(sent.length, 1)
    assert.deepEqual(a, b)
  } finally {
    restore()
  }
})

test('different queries, later repeats and batches are never shared', async () => {
  const { sent, restore } = stubEmbeddings()
  try {
    const [one, two] = await Promise.all([helper.embedTexts(['alpha']), helper.embedTexts(['bravo!'])])
    assert.equal(sent.length, 2)
    assert.deepEqual([one, two], [[[5]], [[6]]])
    await helper.embedTexts(['alpha'])
    assert.equal(sent.length, 3, 'a finished call is not cached')
    await Promise.all([helper.embedTexts(['x', 'y']), helper.embedTexts(['x', 'y'])])
    assert.equal(sent.length, 5, 'multi-text batches are not shared')
  } finally {
    restore()
  }
})

test('a failed shared embedding is not remembered', async () => {
  const realFetch = globalThis.fetch
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY ||= 'test-only'
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response('{"error":"invalid"}', { status: 400 })
  }) as any
  try {
    await assert.rejects(helper.embedTexts(['broken']))
    const before = calls
    await assert.rejects(helper.embedTexts(['broken']))
    assert.ok(calls > before)
  } finally {
    globalThis.fetch = realFetch
  }
})
