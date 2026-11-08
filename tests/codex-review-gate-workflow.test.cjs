const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/codex-review-gate.yml'), 'utf8');

test('codex review gate runs only the script from the production branch', () => {
  assert.match(workflow, /ref: production/);
  assert.match(workflow, /sparse-checkout: \.github\/scripts/);
  assert.match(workflow, /hashFiles\('\.github\/scripts\/codex-review-gate\.cjs'\) != ''/);
  assert.doesNotMatch(workflow, /getContent|head_ref|head\.sha/);
});
