const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');

const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../eslint-local-rules/caller-refusals-baseline.json'), 'utf8'));

test('the caller-refusal allowance never grows past PR1 and the three proven sites stay at zero', () => {
  assert.ok(Object.values(baseline).every(count => Number.isInteger(count) && count >= 0));
  assert.ok(Object.values(baseline).reduce((total, count) => total + count, 0) <= 225);
  for (const file of ['tasks/fields/section.ts', 'tasks/agentMutationFence.ts', 'operations/tasks/attachments/operation.ts']) {
    assert.equal(baseline[`src/lib/mcp/${file}`], 0);
  }
});

test('the rule rejects new raw throws, assigned raw throws, error logs, and Error subclasses, but accepts the boundary contract', async () => {
  const { callerRefusalsRule } = await import('../eslint-local-rules/caller-refusals.mjs');
  const linter = new Linter();
  const config = [{ files: ['**/*.{js,ts}'], plugins: { refusal: { rules: { boundary: callerRefusalsRule } } }, rules: { 'refusal/boundary': 'error' } }];
  for (const code of [
    'throw new Error("bad input")',
    'throw Object.assign(new Error("bad input"), { status: 400, code: "invalid_value" })',
    'const error = new Error("bad input"); throw Object.assign(error, { status: 409, code: "task_move_refused" })',
    'console.error("bad input")',
    'class CallerMistake extends Error {}',
  ]) {
    const messages = linter.verify(code, config, { filename: path.resolve('src/lib/mcp/new-operation.js') });
    assert.equal(messages.length, 1, code);
    assert.equal(messages[0].ruleId, 'refusal/boundary');
    assert.match(messages[0].message, /RefusalError.*wrapMcpRoute/);
  }
  assert.deepEqual(linter.verify('throw new RefusalError({status: 400, reason: "invalid_field", field: "title", message: "Required"})', config), []);
  assert.deepEqual(linter.verify('console.warn("refused"); throw fault', config), []);
  const filename = path.resolve('src/lib/mcp/attachments/storeBatch.ts');
  const count = baseline['src/lib/mcp/attachments/storeBatch.ts'];
  const code = Array.from({ length: count + 1 }, (_, index) => `class Fault${index} extends Error {}`).join('\n');
  assert.equal(linter.verify(code, config, { filename }).length, 1);
});
