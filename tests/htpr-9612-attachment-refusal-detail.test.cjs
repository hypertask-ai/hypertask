const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule: load } = require('./helpers/loadModule.cjs');

class McpAttachmentFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'McpAttachmentFetchError';
  }
}

const refusal = load('src/lib/api/refusal.ts', { '@/lib/planLimits': { isPlanLimitReachedError: () => false } });

function loadStoreBatch() {
  return load('src/lib/mcp/attachments/storeBatch.ts', {
    '@/lib/planLimits': { isPlanLimitReachedError: () => false },
    '@/lib/api/refusal': refusal,
    '@/lib/storage/uploadTaskAttachmentToS3': {
      buildTaskAttachmentStorageKey: ({ fileName }) => `key/${fileName}`,
      getHypertasksObjectState: async () => 'exists',
      uploadTaskAttachmentToS3: async () => 'https://cdn.example.com/file',
    },
    '@/lib/storage/hypertasksS3': { getHypertasksStoragePublicUrl: (key) => `https://cdn.example.com/${key}` },
    './constants': {
      MCP_ATTACHMENT_BATCH_TIMEOUT_MS: 5000,
      MCP_ATTACHMENT_MAX_BATCH_BYTES: 1024 * 1024 * 1024,
      normalizeMime: (mime) => mime,
    },
    './magicBytes': { bufferMatchesDeclaredMime: () => true },
    './safeFetch': { McpAttachmentFetchError, safeFetchAttachmentUrl: async () => ({}) },
  });
}

const files = [
  { kind: 'url', filename: 'page.png', contentType: 'image/png', url: 'https://example.com/page' },
  { kind: 'url', filename: 'doc.pdf', contentType: 'application/pdf', url: 'https://example.com/doc' },
];

test('a caller URL failure keeps the per-file detail on the refusal (HTPR-9612)', async () => {
  const { storeAttachmentBatch, AttachmentInputRefusalError } = loadStoreBatch();
  const failure = new McpAttachmentFetchError('Unsupported Content-Type from URL: text/html');
  await assert.rejects(
    () => storeAttachmentBatch(files, { taskId: 1, targetKey: 'description-1' }, async () => [], {
      fetchUrl: async () => { throw failure },
    }),
    (error) => {
      assert.ok(error instanceof AttachmentInputRefusalError, error.name);
      assert.ok(error instanceof refusal.RefusalError, error.name);
      assert.equal(error.refusal.status, 400);
      assert.equal(error.refusal.reason, 'invalid_field');
      assert.equal(error.refusal.field, 'files');
      assert.equal(error.message, 'Unsupported Content-Type from URL: text/html');
      assert.deepEqual(error.failedFiles, [
        { index: 0, filename: 'page.png', error: 'Unsupported Content-Type from URL: text/html' },
        { index: 1, filename: 'doc.pdf', error: 'Not attempted because the batch failed during preparation' },
      ]);
      return true;
    },
  );
});

test('storage 500 and timeout 504 stay server faults, not caller refusals (HTPR-9612)', async () => {
  const { storeAttachmentBatch, AttachmentBatchError } = loadStoreBatch();
  await assert.rejects(
    () => storeAttachmentBatch(files.slice(0, 1), { taskId: 1, targetKey: 'description-1' }, async () => [], {
      fetchUrl: async () => ({ buffer: Buffer.from('image'), contentType: 'image/png' }),
      upload: async () => { throw new Error('S3 unavailable') },
      objectState: async () => 'missing',
    }),
    (error) => {
      assert.ok(error instanceof AttachmentBatchError);
      assert.equal(error.status, 500);
      assert.equal(refusal.refusalOf(error), null);
      return true;
    },
  );
});
