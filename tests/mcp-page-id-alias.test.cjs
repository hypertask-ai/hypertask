const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const jiti = require('jiti')(
  path.join(root, 'tests/mcp-page-id-alias-entry.cjs'),
  {
    interopDefault: true,
    cache: false,
  }
);

const {
  GetPageInputSchema,
  PageHistoryInputSchema,
  UpdatePageInputSchema,
} = jiti(
  path.join(root, 'src/lib/mcp-server/validations/page.validation.ts')
);

const schemas = [
  ['get_page', GetPageInputSchema, {}],
  ['update_page', UpdatePageInputSchema, { content: 'Updated content' }],
  ['page_history', PageHistoryInputSchema, { action: 'versions' }],
];

test('page_id alone is accepted and normalized to id', () => {
  for (const [name, schema, required] of schemas) {
    const parsed = schema.parse({ ...required, page_id: 'page-public-id' });
    assert.equal(parsed.id, 'page-public-id', name);
    assert.equal('page_id' in parsed, false, name);
  }
});

test('id alone remains accepted', () => {
  for (const [name, schema, required] of schemas) {
    const parsed = schema.parse({ ...required, id: 5121 });
    assert.equal(parsed.id, 5121, name);
    assert.equal('page_id' in parsed, false, name);
  }
});

test('agreeing page_id and id values are accepted', () => {
  for (const [name, schema, required] of schemas) {
    const parsed = schema.parse({
      ...required,
      id: '5121',
      page_id: 5121,
    });
    assert.equal(parsed.id, 5121, name);
    assert.equal('page_id' in parsed, false, name);
  }
});

test('disagreeing page_id and id values are rejected clearly', () => {
  for (const [name, schema, required] of schemas) {
    const result = schema.safeParse({
      ...required,
      id: 5121,
      page_id: 5122,
    });
    assert.equal(result.success, false, name);
    assert.match(result.error.issues[0].message, /page_id and id.*same page/, name);
  }
});

test('a missing page identifier names both accepted field names', () => {
  for (const [name, schema, required] of schemas) {
    const result = schema.safeParse(required);
    assert.equal(result.success, false, name);
    assert.match(result.error.issues[0].message, /page_id or id/, name);
    assert.doesNotMatch(result.error.issues[0].code, /invalid_union/, name);
  }
});

test('affected tool descriptions prefer page_id and retain id compatibility', () => {
  const metadata = fs.readFileSync(
    path.join(root, 'src/lib/mcp-server/config/tool-metadata.ts'),
    'utf8'
  );

  for (const key of ['GET_PAGE', 'UPDATE_PAGE', 'PAGE_HISTORY']) {
    const start = metadata.indexOf(`  ${key}: {`);
    const end = metadata.indexOf('\n  },', start);
    const entry = metadata.slice(start, end);
    assert.match(entry, /page_id/, key);
    assert.match(entry, /id is still accepted/, key);
  }
});

test('update_page accepts title-only renames and still requires a mutation', () => {
  const renamed = UpdatePageInputSchema.parse({
    id: 47,
    title: 'Renamed page',
  });
  assert.equal(renamed.title, 'Renamed page');
  assert.equal(renamed.content, undefined);

  const empty = UpdatePageInputSchema.safeParse({ id: 47 });
  assert.equal(empty.success, false);
  assert.match(empty.error.issues[0].message, /title or content/i);
});
