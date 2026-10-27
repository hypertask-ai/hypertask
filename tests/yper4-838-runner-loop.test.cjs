const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '.claude', 'skills');
const read = (name) => fs.readFileSync(path.join(root, name, 'SKILL.md'), 'utf8');

function checkRunnerRoutes(ship, qa, reflect) {
  assert.ok(ship.includes('Agent-to-agent session messaging is closed by default'));
  assert.ok(ship.includes("Valentin's explicit request and an expiring pass"));
  assert.ok(ship.includes('Never infer permission from a role, reason tag or ticket link'));
  assert.ok(ship.includes('mark the ticket blocked on HT Product Lead'));
  assert.ok(ship.includes('Never put user 6 in the blocker field'));
  for (const instructions of [ship, qa]) {
    assert.ok(instructions.includes('--section "Agent Blocked (Infra)"` on board 15'));
    assert.ok(instructions.includes('--section "Agent Blocked"` on board 4060'));
    assert.ok(!instructions.includes('If the current CLI/API cannot select an agent blocker'));
    assert.ok(!instructions.includes('If the installed tool cannot select an agent blocker'));
  }
  assert.ok(ship.includes('Skip blocked tickets when picking work'));
  assert.ok(ship.includes('do not self-merge protected changes'));
  assert.ok(ship.includes('Ordinary notes do not wake another session'));
  assert.ok(ship.includes('Leave the review and merge to HT Product Lead'));
  assert.ok(ship.includes('ht-flag set KEY off --failure'));
  assert.ok(ship.includes('Other modes retain their existing approval rules'));
  assert.ok(qa.includes('switch flagged failure Off through [ship]'));
  assert.ok(!qa.includes('with SendMessage at once'));
  assert.ok(reflect.includes('do not send a session message or wait for a lead response'));
  assert.ok(reflect.includes('Accepted findings become their own tickets and normal reviewed PRs'));
}

test('runner documents contain the required ticket-only and protected-review instructions', () => {
  checkRunnerRoutes(read('ship'), read('verify-qa'), read('reflect'));
});

test('document checks reject removed routing requirements and incorrect board columns', () => {
  const ship = read('ship');
  const qa = read('verify-qa');
  const reflect = read('reflect');
  assert.throws(() => checkRunnerRoutes(ship.replace('Agent-to-agent session messaging is closed by default', 'send agent messages'), qa, reflect));
  assert.throws(() => checkRunnerRoutes(ship, qa.replace('switch flagged failure Off through [ship]', 'ask the lead to stop the flag'), reflect));
  assert.throws(() => checkRunnerRoutes(ship, qa, reflect.replace('do not send a session message or wait for a lead response', 'wait for the lead')));
  assert.throws(() => checkRunnerRoutes(ship.replaceAll('mark the ticket blocked on HT Product Lead', 'message the lead'), qa, reflect));
  assert.throws(() => checkRunnerRoutes(ship.replace('Leave the review and merge to HT Product Lead', 'merge protected changes yourself'), qa, reflect));
  assert.throws(() => checkRunnerRoutes(ship.replace('--section "Agent Blocked"', '--section "In Progress"'), qa, reflect));
  assert.throws(() => checkRunnerRoutes(ship, qa.replace('--section "Agent Blocked (Infra)"', '--section "In Progress"'), reflect));
  assert.throws(() => checkRunnerRoutes(ship.replace('on board 4060', 'on board 15'), qa, reflect));
  assert.throws(() => checkRunnerRoutes(ship, qa, reflect.replace('Accepted findings become their own tickets and normal reviewed PRs', 'apply findings without review')));
});
