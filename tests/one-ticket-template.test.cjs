const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');
const template = load('src/lib/tickets/plainLanguageTicket.mjs');
const writing = load('src/lib/agents/writing.ts', { '@/lib/tickets/plainLanguageTicket.mjs': template });
const block = template.renderPlainLanguageTicketDescription({
  whatWrongOrWanted: 'Search misses reminders.', whoItAffects: 'Everyone.',
  recommendedCourseAndWhy: 'Restore search. People need their reminders.',
  whatValentinMustDecide: 'Nothing.', howToUndo: 'Revert the change.',
});
const check = (description, title = 'Search finds reminders') => writing.assertAgentWriting('agent', {title, description}, {}, {create:true, houseRules:true});
for (const [name, evidence] of Object.entries({
  'one common template': '',
  'repro commands': '<pre>node scripts/repro.mjs --project_id 15</pre>',
  'raw error': '<pre>Traceback: stderr exit code 1</pre>',
  'status and ids': '<p>Next: retry. Branch/PR: a12bc3456789</p>',
  'long evidence': '<p>This is the full diagnostic evidence with every detail kept together for the next agent reading the ticket.</p>',
})) test(`accepts ${name}`, () => assert.doesNotThrow(() => check(block + evidence)));
test('still refuses paths and status above the divider', () => {
  assert.throws(() => check(block.replace('Everyone.', 'Next: inspect src/lib/search.ts.')), /Robot status/);
});
test('one refusal lists every broken rule across fields', () => {
  assert.throws(() => check('<p>Next: inspect src/lib/search.ts.</p>', 'Resume: later'), error => {
    for (const part of ['Robot status', 'Technical detail', ...template.PLAIN_LANGUAGE_TICKET_LABELS]) assert.ok(error.message.includes(part), part);
    assert.ok(error.violations.length >= 4);
    return true;
  });
});
test('labels after the divider cannot repair a broken opening', () => {
  assert.equal(template.hasPlainLanguageTicketBlock('<p>What\'s wrong or wanted: Search fails.</p><hr>' + block), false);
});
test('template requires ordered nonempty values', () => {
  assert.equal(template.hasPlainLanguageTicketBlock(template.renderPlainLanguageTicketDescription({})), false);
  assert.equal(template.hasPlainLanguageTicketBlock(block.replace("What's wrong or wanted", 'Who it affects').replace('Who it affects:</strong> Everyone.', "What's wrong or wanted:</strong> Everyone.")), false);
});
test('writer output passes the same validator and defaults brain label', () => {
  const brain = load('src/lib/ai/taskWriterBrainLabels.ts');
  const labels = brain.brainLabelsFromBoard([{id:'medium',value:'brain-medium'},{id:'bug',value:'Bug'}]);
  const writer = load('src/app/api/ai/_lib/taskWriterProperties.ts');
  const draft = writer.extractTaskWriterProperties('<h1 id="ai-generated-task-title">Search finds reminders</h1>' + block + '<pre>node scripts/repro.mjs --project_id 15</pre>', {boardLabelIds:['medium','bug'],brainLabels:labels});
  assert.deepEqual(draft.labelIds,['medium']);
  assert.doesNotThrow(() => check(draft.description, draft.title));
});
const refusedToday = require('./fixtures/one-ticket-template/refused-today.json');
for (const fixture of refusedToday) test(`real refused text preserved below divider: ${fixture.id}`, () => {
  const escape = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const evidence = fixture.originalFormat === 'html' ? fixture.raw : `<pre>${escape(fixture.raw)}</pre>`;
  assert.doesNotThrow(() => check(block + evidence));
});
test('moving an old evidence path above the divider is refused', () => {
  assert.throws(() => writing.assertAgentWriting('agent', {description:block.replace('Everyone.', 'Open src/lib/search.ts.')}, {description:block+'<p>Open src/lib/search.ts.</p>'}, {houseRules:true}), /Technical detail/);
});
test('fake dividers in HTML attributes or comments cannot hide bad prose', () => {
  for (const fake of ['<!-- <hr> -->','<span title="<hr>"></span>','&lt;hr&gt;']) {
    assert.throws(() => check(block.replace('Everyone.', `${fake}Next: inspect src/lib/search.ts.`)), /Technical detail/);
  }
});
test('refusals remain caller-fixable with all violations', () => {
  const fixable = load('src/lib/aiFeedback/callerFixable.ts');
  try { check('<p>Next: inspect src/lib/search.ts.</p>'); assert.fail('accepted'); }
  catch (error) {
    const details = writing.agentWritingDetails(error);
    assert.equal(details.violations.length,3);
    assert.equal(fixable.callerCanFixRefusal(details,400),true);
  }
});
