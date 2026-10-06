const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const script = path.resolve(__dirname, '../scripts/lint-changed.mjs');
function run(changed, untracked = '', gitStatus = '0', eslintStatus = '0', allChanged = changed) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ht-lint-changed-'));
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'git'), `#!/bin/sh
[ "$GIT_STATUS" = 0 ] || exit "$GIT_STATUS"
case "$1" in
merge-base) echo base ;;
diff) case "$*" in *--diff-filter*) files="$CHANGED" ;; *) files="$ALL_CHANGED" ;; esac
printf '%s' "$files" | sed 's/|/\\n/g' | while IFS= read -r file; do printf '%s\\0' "$file"; done ;;
ls-files) printf '%s' "$UNTRACKED" | sed 's/|/\\n/g' | while IFS= read -r file; do printf '%s\\0' "$file"; done ;;
esac
`, { mode: 0o755 });
    writeFileSync(path.join(bin, 'eslint'), '#!/bin/sh\nprintf "%s\\n" "$@" >"$ARG_LOG"\nexit "$ESLINT_STATUS"\n', { mode: 0o755 });
    const log = path.join(dir, 'eslint-args');
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CHANGED: changed, UNTRACKED: untracked,
        GIT_STATUS: gitStatus, ESLINT_STATUS: eslintStatus, ARG_LOG: log, ALL_CHANGED: allChanged }, encoding: 'utf8',
    });
    let args = [];
    try { args = readFileSync(log, 'utf8').trim().split('\n'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { ...result, files: args.slice(args.indexOf('--') + 1) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('changed lint includes tracked and untracked code, preserves spaces, deduplicates, and skips docs', () => {
  const result = run('src/a.ts|src/has space.tsx|README.md|', 'src/new.mjs|src/a.ts|');
  assert.equal(result.status, 0);
  assert.deepEqual(result.files, ['src/a.ts', 'src/has space.tsx', 'src/new.mjs']);
  const docs = run('README.md|');
  assert.equal(docs.status, 0);
  assert.match(docs.stdout, /No changed JavaScript or TypeScript/);
  assert.deepEqual(docs.files, []);
});

test('lint configuration, rules and dependencies trigger full lint instead of unsafe narrowing', () => {
  for (const file of ['eslint.config.mjs', 'eslint-local-rules/custom.mjs', 'package.json', 'package-lock.json', 'tsconfig.json']) {
    const result = run(`${file}|`);
    assert.equal(result.status, 0);
    assert.deepEqual(result.files, ['.']);
    const deleted = run('', '', '0', '0', `${file}|`);
    assert.equal(deleted.status, 0);
    assert.deepEqual(deleted.files, ['.']);
  }
});

test('changed lint fails closed on Git errors and propagates ESLint failure', () => {
  assert.notEqual(run('src/a.ts|', '', '1').status, 0);
  assert.equal(run('src/a.ts|', '', '0', '9').status, 9);
});
