const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/codex-review-gate.yml'), 'utf8'));

test('codex review gate runs only the script from the production branch', () => {
  const [checkout, gate] = workflow.jobs.gate.steps;
  assert.equal(checkout.with.ref, 'production');
  assert.equal(checkout.with['sparse-checkout'], '.github/scripts');
  assert.equal(gate.if, "hashFiles('.github/scripts/codex-review-gate.cjs') != ''");
});
