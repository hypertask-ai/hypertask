const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('test files live in tests/ so the CI inventory runs them', () => {
  const source = path.join(__dirname, '..', 'src');
  const misplaced = readdirSync(source, { recursive: true })
    .filter((file) => /\.test\.(?:ts|tsx|js|cjs|mjs)$/.test(file))
    .sort();

  assert.deepEqual(
    misplaced,
    [],
    misplaced.map((file) => `src/${file}: move it to tests/`).join('\n'),
  );
});
