import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { createJiti } from 'jiti'


const root = path.resolve(__dirname, '..')
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })
const helper = jiti(path.join(root, 'src/utils/controllers/turbopuffer/turbopufferHelper.ts')) as any

test('embedding inputs are never empty and never over the cap', async () => {
  const sent: string[][] = []
  const realFetch = globalThis.fetch
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY ||= 'test-only'
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { input } = JSON.parse(init.body)
    sent.push(input)
    for (const text of input) {
      if (!text || text.length > helper.EMBEDDING_MAX_INPUT_CHARS) {
        return new Response('{"error":"invalid input"}', { status: 400 })
      }
    }
    const data = input.map((_: string, index: number) => ({ index, embedding: new Array(helper.EMBEDDING_DIM).fill(0) }))
    return new Response(JSON.stringify({ data }), { status: 200 })
  }) as any

  try {
    const texts = ['', '   ', 'x'.repeat(50_000), 'a short comment', ...Array.from({ length: 150 }, (_, i) => `row ${i}`)]
    const embeddings = await helper.embedTexts(texts)
    assert.equal(embeddings.length, texts.length)
    const all = sent.flat()
    assert.equal(all.length, texts.length)
    assert.ok(all.every((text) => text.length > 0 && text.length <= helper.EMBEDDING_MAX_INPUT_CHARS))
    assert.equal(all[3], 'a short comment')
    assert.ok(sent.every((batch) => batch.length <= 64), 'batches stay within the request token budget')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('toEmbeddingInput keeps short text and trims whitespace', () => {
  assert.equal(helper.toEmbeddingInput('  hello\n world  '), 'hello world')
  assert.equal(helper.toEmbeddingInput('').length > 0, true)
  assert.equal(helper.toEmbeddingInput('y'.repeat(9000)).length, helper.EMBEDDING_MAX_INPUT_CHARS)
})
