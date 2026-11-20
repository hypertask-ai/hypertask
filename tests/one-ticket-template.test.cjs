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
const accepted = require('./fixtures/one-ticket-template/accepted-evidence.json');
for (const [name, evidence] of Object.entries(accepted)) test(`accepts ${name}`, () => assert.doesNotThrow(() => check(block + evidence)));
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
  for (const entity of ['&#39;', '&#x27;', '&apos;']) assert.doesNotThrow(() => check(block.replace('&#x27;', entity)));
  assert.equal(template.hasPlainLanguageTicketBlock(template.renderPlainLanguageTicketDescription({})), false);
  assert.equal(template.hasPlainLanguageTicketBlock(block.replace("What's wrong or wanted", 'Who it affects').replace('Who it affects:</strong> Everyone.', "What's wrong or wanted:</strong> Everyone.")), false);
});
const refusedToday = require('./fixtures/one-ticket-template/refused-today.json');
const esc = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
for (const fixture of refusedToday) test(`real refused text preserved below divider: ${fixture.id}`, () => {
  assert.doesNotThrow(() => check(`${block}<pre>${esc(fixture.raw)}</pre>`));
});
test('moving an old evidence path above the divider is refused', () => {
  assert.throws(() => writing.assertAgentWriting('agent', {description:block.replace('Everyone.', 'Open src/lib/search.ts.')}, {description:block+'<p>Open src/lib/search.ts.</p>'}, {houseRules:true}), /Technical detail/);
});
test('fake dividers in HTML attributes or comments cannot hide bad prose', () => {
  for (const fake of ['<!-- <hr> -->','<span title="<hr>"></span>','&lt;hr&gt;']) {
    assert.throws(() => check(block.replace('Everyone.', `${fake}Next: inspect src/lib/search.ts.`)), /Technical detail/);
  }
});
test('markup outside the labels leaves the template intact', () => {
  for (const noise of ['<span title="<hr>">', "<span title='<HR>'>", '<!-- <hr> -->', '<script>var a="<hr>"</script>']) assert.doesNotThrow(() => check(noise + block));
  assert.doesNotThrow(() => check(block.replace('Restore search.', 'Restore\nsearch.')));
});
test('each required label owns a separate opening line', () => {
  assert.equal(template.hasPlainLanguageTicketBlock(block.replace(/<\/p><p>/g, ' ')), false);
});
function setup(labels) {
  const created=[];
  const db={$executeRaw:async()=>{},$transaction:async run=>run(db),label:{findMany:async()=>labels,create:async({data})=>{created.push(data);return {id:'created-medium'};}}};
  return {created,...load('src/lib/agents/defaultBrainLabel.ts',{'@/lib/prisma':{default:db}})};
}
test('brain defaults keep an existing medium, add one when absent, keep an explicit pick',async()=>{
  const kept=setup([{id:'bug',value:'Bug'},{id:'medium',value:'brain-medium'}]);
  assert.deepEqual(await kept.defaultAgentBrainLabelIds(7,['bug']),['bug','medium']);
  assert.equal(kept.created.length,0);
  const fresh=setup([]);
  assert.deepEqual(await fresh.defaultAgentBrainLabelIds(7,[]),['created-medium']);
  assert.deepEqual(fresh.created,[{projectId:7,value:'brain-medium'}]);
  const picked=setup([{id:'hard',value:'brain-hard'}]);
  assert.deepEqual(await picked.defaultAgentBrainLabelIds(7,['bug','hard']),['bug','hard']);
  assert.equal(picked.created.length,0);
});
const output='<h1 id="ai-generated-task-title">Search finds reminders</h1>'+template.renderPlainLanguageTicketDescription({whatWrongOrWanted:'Search misses reminders.',whoItAffects:'Everyone.',recommendedCourseAndWhy:'Restore search. People need reminders.',whatValentinMustDecide:'Nothing.',howToUndo:'Revert the change.'})+'<pre>node scripts/repro.mjs --project_id 15</pre>';
function writer(text) {
 return load('src/app/api/ai/_lib/taskWriterDraft.ts',{
  'ai':{generateText:async()=>({text})},
  './taskWriterRun':{prepareTaskWriterRun:async()=>({selected:{model:{},modelId:'fixture',settings:{}},instructions:template.plainLanguageTicketWriterRule(),messages:[],skills:[],validateDraft:true})},
  './modelProvider':{configureAiModelUsage(){}},
  './editorAi':{filterOneImagePass:text=>({emit:text})},
  '@/lib/net/downloadWithoutBrotli':{downloadWithoutBrotli(){}},
  '@/lib/agents/writing':writing,
 }).generateTaskWriterDraft({aiMode:'AiTaskWriter',taskTitle:'',PROMPT:'Restore search'},6,'agent');
}
test('the actual writer draft output passes the ticket validator',async()=>{
 const draft=await writer(output);
 assert.equal(draft.success,true);
 assert.doesNotThrow(()=>writing.assertAgentWriting('agent',{title:draft.title,description:draft.html},{},{create:true,houseRules:true}));
});
test('the writer refuses its own invalid output before returning success',async()=>{
 const draft=await writer(output.replace('Everyone.','Next: inspect src/lib/search.ts.'));
 assert.equal(draft.success,false);
 assert.match(draft.error,/Robot status/);
 assert.match(draft.error,/Technical detail/);
});
