const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/codex-review-gate.yml'), 'utf8');

test('codex review gate loads trusted production script, with PR-head bootstrap before merge', () => {
  assert.match(workflow, /ref: production/);
  assert.match(workflow, /sparse-checkout: \.github\/scripts/);
  assert.match(workflow, /path: '\.github\/scripts\/codex-review-gate\.cjs'/);
  assert.match(workflow, /repos\.getContent/);
  assert.doesNotMatch(workflow, /checkout[^\n]+\n[^\n]+ref: \$\{\{ github\.head_ref/);
});
