const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '.claude', 'skills');
const read = (name) => fs.readFileSync(path.join(root, name, 'SKILL.md'), 'utf8');

function checkRunnerRoutes(ship, qa, reflect, escalation) {
  assert.ok(ship.includes('Agent-to-agent session messaging is closed by default'));
  assert.ok(ship.includes("Valentin's explicit request and an expiring pass"));
  assert.ok(ship.includes('Never infer permission from a role, reason tag or ticket link'));
  assert.ok(ship.includes('mark the ticket blocked on HT Product Lead'));
  assert.ok(ship.includes('Never put user 6 in the blocker field'));
  for (const instructions of [ship, qa, escalation]) {
    assert.ok(instructions.includes('--section "Agent Blocked (Infra)"` on board 15'));
    assert.ok(instructions.includes('--section "Agent Blocked"` on board 4060'));
    assert.ok(!instructions.includes('If the current CLI/API cannot select an agent blocker'));
    assert.ok(!instructions.includes('If the installed tool cannot select an agent blocker'));
  }
  assert.ok(ship.includes('Skip blocked tickets when picking work'));
  assert.ok(ship.includes('do not self-merge protected changes'));
  assert.ok(ship.includes('Ordinary notes do not wake another session'));
  assert.ok(ship.includes('Leave the review and merge to HT Product Lead'));
  for (const instructions of [ship, qa]) {
    assert.ok(instructions.includes('ht-flag set KEY off --failure'));
    assert.ok(instructions.includes('high-risk, unclassified and bugfix flags retain their existing approval rules'));
    assert.ok(instructions.includes('ht-flag set KEY off --reason'));
    assert.ok(!instructions.includes('with SendMessage at once'));
  }
  assert.ok(reflect.includes('do not send a session message or wait for a lead response'));
  assert.ok(reflect.includes('Accepted findings become their own tickets and normal reviewed PRs'));
  assert.ok(escalation.includes('Reason tags and ticket links never grant permission'));
  assert.ok(escalation.includes('Mark the ticket blocked on HT Product Lead'));
}

test('runner documents contain the required ticket-only and protected-review instructions', () => {
  checkRunnerRoutes(read('ship'), read('verify-qa'), read('reflect'), read('message-poteto'));
});

test('document checks reject removed routing requirements and incorrect board columns', () => {
  const ship = read('ship');
  const qa = read('verify-qa');
  const reflect = read('reflect');
  const escalation = read('message-poteto');
  assert.throws(() => checkRunnerRoutes(ship.replace('Agent-to-agent session messaging is closed by default', 'send agent messages'), qa, reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship, qa.replace('ht-flag set KEY off --failure', 'ask the lead to stop the flag'), reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship, qa, reflect.replace('do not send a session message or wait for a lead response', 'wait for the lead'), escalation));
  assert.throws(() => checkRunnerRoutes(ship.replaceAll('mark the ticket blocked on HT Product Lead', 'message the lead'), qa, reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship.replace('Leave the review and merge to HT Product Lead', 'merge protected changes yourself'), qa, reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship.replace('--section "Agent Blocked"', '--section "In Progress"'), qa, reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship, qa.replace('--section "Agent Blocked (Infra)"', '--section "In Progress"'), reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship.replace('on board 4060', 'on board 15'), qa, reflect, escalation));
  assert.throws(() => checkRunnerRoutes(ship, qa, reflect, escalation.replace('on board 15', 'on board 4060')));
});
