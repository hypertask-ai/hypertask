const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../.claude/skills/fix-bug/scripts/open-pr.sh');
const prUrl = 'https://github.com/hypertask-ai/hypertask/pull/123';

function runScript(t, args = [], env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-pr-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'commands');
  const body = path.join(root, 'body.md');
  fs.writeFileSync(log, '');
  fs.writeFileSync(body, '# Summary for non-engineers\nReview this fix.\nWhat went wrong\nWhat changes\nWhat you will see\nWatch out for\n');
  for (const command of ['git', 'gh', 'hypertask', 'vcc']) {
    fs.writeFileSync(path.join(root, command), `#!/usr/bin/env bash
printf '%s\\n' '${command} '"$*" >> "$COMMAND_LOG"
case '${command} '"$*" in
  'git rev-parse --show-toplevel'*) echo "$OPEN_PR_ROOT" ;;
  'git fetch '*) exit 0 ;;
  'git diff '*) printf '%s' "\${DIFF_NUMSTAT:-}"; exit "\${DIFF_EXIT:-0}" ;;
  'git push '*) exit "\${PUSH_EXIT:-0}" ;;
  'gh pr create '*)
    if [ "\${CREATE_EXIT:-0}" != 0 ]; then echo 'create refused' >&2; exit "$CREATE_EXIT"; fi
    echo '${prUrl}' ;;
  'gh pr merge '*) echo 'Auto merge is not allowed for this repository' >&2; exit 1 ;;
  'vcc task move '*) exit "\${MOVE_EXIT:-0}" ;;
  'hypertask --json task get '*)
    if [ "\${READ_EXIT:-0}" != 0 ]; then exit "$READ_EXIT"; fi
    printf '{"tasks":[{"section":"%s","assignees":[]}]}' "$BOARD_SECTION" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  }
  const result = spawnSync('bash', [script, env.TICKET || 'HTPR-6706', 'BUGFIX', 'Keep PR handoffs in review', '--body-file', body, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, PATH: `${root}:${process.env.PATH}`, COMMAND_LOG: log, BOARD_SECTION: 'AI Review', OPEN_PR_ROOT: path.resolve(__dirname, '..'), ...env },
  });
  assert.ifError(result.error);
  return { ...result, commands: fs.readFileSync(log, 'utf8').trim().split('\n') };
}

for (const [lane, section] of [
  [null, 'AI Review'],
  ['ai-review', 'AI Review'],
  ['valentin-review', 'Valentin Review'],
]) {
  test(`PR handoff succeeds with auto-merge disabled for ${lane || 'the default lane'}`, (t) => {
    const result = runScript(t, lane ? ['--lane', lane] : [], { BOARD_SECTION: section });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR opened\./);
    assert.ok(result.stdout.split('\n').includes(`  pr:        ${prUrl}`));
    assert.ok(result.stdout.includes(`section:   ${section} (read back from the board)`));
    assert.match(result.stdout, /automerge=no/);
    assert.equal(result.commands.length, 7);
    assert.equal(result.commands[0], 'git rev-parse --show-toplevel');
    assert.equal(result.commands[1], 'git fetch origin production');
    assert.match(result.commands[2], /^git diff --numstat -M --no-ext-diff --diff-filter=ADMR origin\/production\.\.\.HEAD$/);
    assert.equal(result.commands[3], 'git push -u origin HEAD');
    assert.match(result.commands[4], /^gh pr create --base production /);
    assert.equal(result.commands[5], `vcc task move HTPR-6706 --section ${section}`);
    assert.equal(result.commands[6], 'hypertask --json task get HTPR-6706');
    assert.ok(!result.commands.some((command) => command.startsWith('gh pr merge')));
  });
}

for (const lane of ['supervisor-review', 'ht-manager-review']) {
  test(`retired lane ${lane} is refused before anything runs`, (t) => {
    const result = runScript(t, ['--lane', lane]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--lane must be ai-review or valentin-review/);
    assert.deepEqual(result.commands, ['']);
  });
}

test('dry run leaves auto-merge off without executing external commands', (t) => {
  const result = runScript(t, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /automerge=no/);
  assert.doesNotMatch(result.stdout, /gh.*merge/);
  assert.equal(result.commands[0], 'git rev-parse --show-toplevel');
  assert.equal(result.commands[1], 'git fetch origin production');
  assert.match(result.commands[2], /^git diff /);
  assert.equal(result.commands.length, 3);
});

test('an over-cap diff is refused before the push', (t) => {
  const result = runScript(t, [], { DIFF_NUMSTAT: '1256\t0\tsrc/big.ts\n' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PR size: 1256 hand-written lines is over the 400-line cap\. Split it into smaller changes that each build green\./);
  assert.match(result.stderr, /would be refused before opening/);
  assert.doesNotMatch(result.stdout, /PR opened\./);
  assert.equal(result.commands.length, 3);
  assert.equal(result.commands[0], 'git rev-parse --show-toplevel');
});

test('a title with no ticket and tag is refused before anything is pushed', (t) => {
  const result = runScript(t, [], { TICKET: 'NOPE-12' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /got:      NOPE-12 \[BUGFIX\] Keep PR handoffs in review/);
  assert.match(result.stderr, /expected: \(HTPR\|HYFA\|YPER4\|HYCI\)-<n> \[TAG\] <summary>/);
  assert.doesNotMatch(result.stdout, /PR opened\./);
  assert.deepEqual(result.commands, ['git rev-parse --show-toplevel', 'git fetch origin production']);
});

test('an over-cap diff opens only with a recorded reason', (t) => {
  const result = runScript(t, ['--size-ok', 'one mechanical rename across forty files'], {
    DIFF_NUMSTAT: '1256\t0\tsrc/big.ts\n',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR size exception recorded: one mechanical rename across forty files/);
  assert.match(result.stdout, /PR opened\./);
});

test('an unmeasurable diff refuses the handoff instead of guessing', (t) => {
  const result = runScript(t, [], { DIFF_EXIT: '128' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PR size could not be measured against origin\/production/);
  assert.equal(result.commands.length, 3);
});

for (const [name, env, error, commandCount] of [
  ['push failure', { PUSH_EXIT: '1' }, /git push to origin failed/, 4],
  ['PR creation failure', { CREATE_EXIT: '1' }, /gh pr create failed/, 5],
  ['board move failure', { MOVE_EXIT: '1' }, /Moving HTPR-6706 to 'AI Review' failed/, 6],
  ['board read failure', { READ_EXIT: '1' }, /Could not read HTPR-6706 back/, 7],
  ['wrong review section', { BOARD_SECTION: 'Agent Blocked (Infra)' }, /not 'AI Review'.*wrong review queue/, 7],
  ['in progress readback after review move', { BOARD_SECTION: 'In Progress' }, /in 'In Progress', not 'AI Review'.*wrong review queue/, 7],
]) {
  test(`${name} remains a failed handoff`, (t) => {
    const result = runScript(t, [], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.doesNotMatch(result.stdout, /PR opened\./);
    assert.equal(result.commands.length, commandCount);
    if (name === 'in progress readback after review move') {
      assert.equal(result.commands[5], 'vcc task move HTPR-6706 --section AI Review');
      assert.equal(result.commands[6], 'hypertask --json task get HTPR-6706');
    }
  });
}
