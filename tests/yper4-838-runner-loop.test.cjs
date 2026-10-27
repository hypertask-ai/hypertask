const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '.claude', 'skills');
const read = (name) => fs.readFileSync(path.join(root, name, 'SKILL.md'), 'utf8');

function checkRunnerRoutes(ship, qa, reflect, escalation) {
  assert.ok(ship.includes('never send session messages'));
  assert.ok(ship.includes('after two concrete attempts'));
  assert.ok(ship.includes('Protected review remains mandatory'));
  assert.ok(ship.includes('without `--kind` on that same ticket'));
  assert.ok(ship.includes('Leave the review and merge to HT Product Lead'));
  for (const instructions of [ship, qa]) {
    assert.ok(instructions.includes('ht-flag set KEY off --failure'));
    assert.ok(instructions.includes('high-risk, unclassified and bugfix flags retain their existing approval rules'));
    assert.ok(instructions.includes('ht-flag set KEY off --reason'));
    assert.ok(!instructions.includes('with SendMessage at once'));
  }
  assert.ok(reflect.includes('do not send a session message or wait for a lead response'));
  assert.ok(reflect.includes('Accepted findings become their own tickets and normal reviewed PRs'));
  assert.ok(!reflect.includes('Send the full Accepted / Rejected / Backlog list to HT Product Lead with SendMessage'));
  assert.ok(escalation.includes('Do not run `poke-poteto`'));
  assert.ok(escalation.includes('without `--kind`'));
}

test('runner-owned workflow preserves protected review and flag approvals without session handoffs', () => {
  checkRunnerRoutes(read('ship'), read('verify-qa'), read('reflect'), read('message-poteto'));
});

test('routing check rejects the old flag, reflection and protected-review session handoffs', () => {
  const ship = read('ship');
  const qa = read('verify-qa');
  const reflect = read('reflect');
  const escalation = read('message-poteto');
  assert.throws(() => checkRunnerRoutes(ship.replace('never send session messages', 'send session messages'), qa, reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship, qa.replace('ht-flag set KEY off --failure', 'ask the lead to stop the flag'), reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship, qa, reflect.replace('do not send a session message or wait for a lead response', 'wait for the lead'), escalation));
  assert.throws(() => checkRunnerRoutes(ship.replace('Leave the review and merge to HT Product Lead', 'merge protected changes yourself'), qa, reflect, escalation));
});
