const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('comment wrapper checks writing before credentials, preserving agent notes and Questions', () => {
  const output = execFileSync('bash', ['.claude/skills/vcc/bin/vcc.test.sh'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.match(output, /comment style boundary ok/);
});
