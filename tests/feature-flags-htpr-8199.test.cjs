const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('HTPR-8199 follow feedback is a reversible bugfix for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8199-follow-shortcut-feedback.ts');
  assert.equal(flag.key, 'htpr-8199-follow-shortcut-feedback');
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});

test('follow notes name why the follow did nothing', () => {
  const { followNote } = loadModule('src/lib/followers/followNote.ts');
  assert.equal(followNote('Task owner cannot be added as follower.'), 'You own this task, so you already get its updates');
  assert.equal(followNote('User/Agent exists as an assignee.'), "You already get this task's updates as an assignee");
  assert.equal(followNote('User/Agent is already a follower.'), 'You already follow this task');
  assert.equal(followNote({ message: 'User does not belong in this board.' }), 'Could not follow this task');
  assert.equal(followNote(undefined), 'Could not follow this task');
});

test('both follow surfaces show the note only when the flag is on', () => {
  for (const file of [
    'src/hooks/General/useFollowerKanban.ts',
    'src/hooks/MultiPages/Tasks/useFollowersPost.ts',
  ]) {
    const source = read(file);
    assert.match(source, /HTPR_8199_FOLLOW_SHORTCUT_FEEDBACK_FLAG/, `${file} must gate the note`);
    assert.match(source, /useFlag\(HTPR_8199_FOLLOW_SHORTCUT_FEEDBACK_FLAG\)/, `${file} must read the flag`);
    assert.match(source, /followNote\(/, `${file} must name the reason`);
  }
  const ownerCase = read('src/hooks/MultiPages/Tasks/useFollowersPost.ts');
  assert.match(ownerCase, /if \(!followsWithNote\) \{\n {6}if \(check\) return;\n {6}if \(parseInt\(task\.userId as string\) === userId\) return;/);
});
