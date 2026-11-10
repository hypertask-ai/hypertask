const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
const jiti = createJiti(__filename, { interopDefault: true, alias: { '@': path.join(root, 'src') }, fsCache: false });
const { default: definition, HTPR_9025_AI_BOX_OUTLINE_FLAG: key } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-9025-ai-box-outline.ts'));
const source = fs.readFileSync(path.join(root, 'src/components/RTE/Components/InlineDraftAiFloat.tsx'), 'utf8');

test('Write with AI box outline ships behind its own Owner + QA flag', () => {
  assert.equal(key, 'htpr-9025-ai-box-outline');
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA');
});

test('flagged outline uses the shared 1px border token on the borderless box only', () => {
  assert.match(source, /useFlag\(HTPR_9025_AI_BOX_OUTLINE_FLAG\)/);
  assert.match(source, /aiBoxOutline && matchCommentRowControls && "border-thin border-border-light-gray-thin"/);
});
