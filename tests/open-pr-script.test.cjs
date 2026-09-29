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
  for (const command of ['git', 'gh', 'hypertask']) {
    fs.writeFileSync(path.join(root, command), `#!/usr/bin/env bash
printf '%s\\n' '${command} '"$*" >> "$COMMAND_LOG"
case '${command} '"$*" in
  'git fetch '*) exit 0 ;;
  'git push '*) exit "\${PUSH_EXIT:-0}" ;;
  'gh pr create '*)
    if [ "\${CREATE_EXIT:-0}" != 0 ]; then echo 'create refused' >&2; exit "$CREATE_EXIT"; fi
    echo '${prUrl}' ;;
  'gh pr merge '*) echo 'Auto merge is not allowed for this repository' >&2; exit 1 ;;
  'hypertask task move '*) exit "\${MOVE_EXIT:-0}" ;;
  'hypertask --json task get '*)
    if [ "\${READ_EXIT:-0}" != 0 ]; then exit "$READ_EXIT"; fi
    printf '{"tasks":[{"section":"%s","assignees":[]}]}' "$BOARD_SECTION" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  }
  const result = spawnSync('bash', [script, 'HTPR-6706', 'BUGFIX', 'Keep PR handoffs in review', '--body-file', body, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, PATH: `${root}:${process.env.PATH}`, COMMAND_LOG: log, BOARD_SECTION: 'AI Review', ...env },
  });
  assert.ifError(result.error);
  return { ...result, commands: fs.readFileSync(log, 'utf8').trim().split('\n') };
}

for (const [lane, section] of [
  [null, 'AI Review'],
  ['ai-review', 'AI Review'],
  ['supervisor-review', 'Supervisor Review'],
  ['ht-manager-review', 'Supervisor Review'],
  ['valentin-review', 'Valentin Review'],
]) {
  test(`PR handoff succeeds with auto-merge disabled for ${lane || 'the default lane'}`, (t) => {
    const result = runScript(t, lane ? ['--lane', lane] : [], { BOARD_SECTION: section });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR opened\./);
    assert.ok(result.stdout.includes(prUrl));
    assert.ok(result.stdout.includes(`section:   ${section} (read back from the board)`));
    assert.match(result.stdout, /automerge=no/);
    assert.equal(result.commands.length, 5);
    assert.equal(result.commands[0], 'git fetch origin production');
    assert.equal(result.commands[1], 'git push -u origin HEAD');
    assert.match(result.commands[2], /^gh pr create --base production /);
    assert.equal(result.commands[3], `hypertask task move HTPR-6706 --section ${section}`);
    assert.equal(result.commands[4], 'hypertask --json task get HTPR-6706');
    assert.ok(!result.commands.some((command) => command.startsWith('gh pr merge')));
  });
}

test('dry run leaves auto-merge off without executing external commands', (t) => {
  const result = runScript(t, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /automerge=no/);
  assert.doesNotMatch(result.stdout, /gh.*merge/);
  assert.deepEqual(result.commands, ['']);
});

for (const [name, env, error, commandCount] of [
  ['push failure', { PUSH_EXIT: '1' }, /git push to origin failed/, 2],
  ['PR creation failure', { CREATE_EXIT: '1' }, /gh pr create failed/, 3],
  ['board move failure', { MOVE_EXIT: '1' }, /Moving HTPR-6706 to 'AI Review' failed/, 4],
  ['board read failure', { READ_EXIT: '1' }, /Could not read HTPR-6706 back/, 5],
  ['wrong review section', { BOARD_SECTION: 'Agent Blocked (Infra)' }, /not 'AI Review'.*wrong review queue/, 5],
]) {
  test(`${name} remains a failed handoff`, (t) => {
    const result = runScript(t, [], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.doesNotMatch(result.stdout, /PR opened\./);
    assert.equal(result.commands.length, commandCount);
  });
}
