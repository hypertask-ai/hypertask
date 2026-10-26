const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreWriter, scoreChips, compareBaseline, replay, runLive, validateCorpus, digest } = require('../scripts/task-writer-eval.cjs');
const corpus = require('./fixtures/task-writer-eval/cases.json');
const simple = { maxWords: 240, requiredSections: ['Problem', 'Done when'], forbiddenSections: ['Hypothesis', 'ICE'], protectedPhrases: ['Proposed:'] };
const good = '<h2>Problem</h2><p>Search omits reminders.</p><h2>Done when</h2><p>Search finds completed reminders.</p><p>Proposed: reuse the search.</p>';

test('long non-AB control fails while a finished synthetic AB control passes', () => {
  assert.deepEqual(scoreWriter(simple, corpus.controls.longNonAb.html).violations, ['too-long', 'missing:Done when', 'forbidden:Hypothesis', 'forbidden:ICE']);
  assert.deepEqual(scoreWriter(corpus.cases.find((c) => c.kind === 'synthetic'), corpus.controls.goodAb.html).violations, []);
  assert.deepEqual(scoreWriter(simple, good).violations, []);
  assert.ok(!scoreWriter(simple, good + '<p>Column: Todo</p>').violations.includes('placeholder'));
  assert.ok(scoreWriter(simple, good + '<p>TODO</p>').violations.includes('placeholder'));
  assert.deepEqual(scoreWriter(simple, '').violations, ['empty-draft', 'missing:Problem', 'missing:Done when']);
});

test('sections accept singular variation, Markdown and acceptance aliases, not a mere body mention', () => {
  assert.deepEqual(scoreWriter(simple, '<h2>Problem</h2><h2>Acceptance criteria</h2><p>The user hypothesis is not a heading.</p>').violations, []);
  assert.deepEqual(scoreWriter(simple, '## Problem\nSearch misses reminders.\n## Done when\nCompleted reminders appear.').violations, []);
  const ab = corpus.cases.find((c) => c.kind === 'synthetic');
  assert.deepEqual(scoreWriter(ab, corpus.controls.goodAb.html.replace('Variations', 'Variation')).violations, []);
  assert.ok(scoreWriter(ab, corpus.controls.goodAb.html.replace('completed reminders option', '[insert copy]')).violations.includes('placeholder'));
});

test('chips reject existing headings, copied prompt examples and required boilerplate edits', () => {
  const result = scoreChips(simple, good, ['Add an acceptance criteria heading', 'Shorten the title without changing its meaning', 'Remove Proposed from the recommendation'], ['Shorten the title without changing its meaning']);
  assert.deepEqual(result.violations, ['0:existing-section:done when', '1:prompt-example', '2:writer-required-text']);
  assert.deepEqual(scoreChips(simple, good, ['Name the affected search screen'], []).violations, []);
  assert.deepEqual(scoreChips(simple, good, [], []).violations, ['empty-chips-unproven']);
  assert.throws(() => scoreChips(simple, good, undefined, []), /Malformed chip response/);
});

test('real pairs are source-hashed own-board versions, and customer controls are synthetic', () => {
  validateCorpus(corpus);
  assert.equal(corpus.cases.filter((c) => c.kind === 'real').length, 20);
  assert.ok(corpus.cases.filter((c) => c.kind === 'synthetic').length >= 2);
  const changed = structuredClone(corpus); changed.cases[0].notes += 'invented';
  assert.throws(() => validateCorpus(changed));
  const customer = structuredClone(corpus); customer.cases[0].source.url = 'https://app.hypertask.ai/detail/project-339/1';
  assert.throws(() => validateCorpus(customer));
  assert.throws(() => replay(corpus, { mode: 'live-production', accountId: 985, corpusHash: digest(corpus), outputs: [] }), /Incomplete live run/);
});

test('live evaluation refuses every non-QA identity before any write', async () => {
  for (const id of [6, 2343]) {
    const calls = [];
    await assert.rejects(runLive(corpus, async (method, url) => { calls.push([method, url]); return { id }; }, () => {}), /Only QA 985/);
    assert.deepEqual(calls, [['GET', '/api/users/getById']]);
  }
});

test('live replay saves the actual writer draft for chips and deletes only its own created task on chip failure', async () => {
  const calls = [];
  let description;
  const api = async (method, url, body) => {
    calls.push([method, url, body]);
    if (url === '/api/users/getById') return { id: 985 };
    if (url === '/api/ai/task-writer') return good;
    if (url === '/api/tasks/createGlobally') { description = body.description; return { newTask: { id: 123, projectId: 7049 } }; }
    if (url === '/api/tasks/single' && method === 'PUT') return {};
    if (url === '/api/tasks/single?id=123') return method === 'PUT' ? {} : { description_: { content: description }, status: calls.some((c) => c[0] === 'PUT') ? 'Deleted' : 'Normal' };
    if (url === '/api/ai/task-questions') throw new Error('provider unavailable');
    throw new Error('unexpected call');
  };
  await assert.rejects(runLive(corpus, api, () => {}), /provider unavailable/);
  assert.equal(description, good);
  assert.deepEqual(calls.filter((c) => c[0] === 'PUT'), [['PUT', '/api/tasks/single', { newTask: { id: 123, status: 'Deleted' } }]]);
});

test('cleanup failure fails the run and persists its incomplete evidence', async () => {
  let persisted;
  const api = async (method, url) => {
    if (url === '/api/users/getById') return { id: 985 };
    if (url === '/api/ai/task-writer') return good;
    if (url === '/api/tasks/createGlobally') return { newTask: { id: 123, projectId: 7049 } };
    if (url === '/api/ai/task-questions') return { questions: ['Name the affected search screen'] };
    if (method === 'PUT') throw new Error('cleanup failed');
    return { description_: { content: good } };
  };
  await assert.rejects(runLive(corpus, api, (record) => { persisted = record; }), /cleanup failed/);
  assert.equal(persisted.outputs.length, 1);
  assert.equal(persisted.outputs[0].cleaned, false);
  assert.deepEqual(persisted.pendingTaskIds, [123]);
});


test('live quality regressions fail independently for writer and chips', () => {
  const baseline = [{ id: 'a', writer: { violations: ['known'] }, chips: { violations: [] } }];
  assert.doesNotThrow(() => compareBaseline(baseline, baseline));
  const worse = structuredClone(baseline); worse[0].writer.violations.push('new');
  assert.throws(() => compareBaseline(worse, baseline), /writer violations increased/);
  const chips = structuredClone(baseline); chips[0].chips.violations.push('existing-section');
  assert.throws(() => compareBaseline(chips, baseline), /chips violations increased/);
});

test('hosted live eval never exposes QA credentials to pull request code', () => {
  const fs = require('node:fs');
  const yaml = require('js-yaml');
  const workflow = yaml.load(fs.readFileSync('.github/workflows/task-writer-eval.yml', 'utf8'));
  assert.ok(!workflow.on.pull_request && !workflow.on.pull_request_target);
  const live = workflow.jobs['task-writer-live'];
  assert.match(live.if, /github\.ref == 'refs\/heads\/production'/);
  assert.match(live.if, /github\.event_name == 'schedule'/);
  assert.match(live.if, /github\.event_name == 'workflow_dispatch'/);
  assert.ok(!live.if.includes("github.event_name == 'pull_request'"));
  assert.equal(live['timeout-minutes'], 20);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const candidate = yaml.load(fs.readFileSync('.github/workflows/ai-evals.yml', 'utf8')).jobs['ai-evals'];
  assert.ok(!JSON.stringify(candidate).includes('secrets.QA_'));
  assert.ok(candidate.steps.some((step) => step.run === 'node scripts/task-writer-eval.cjs --verify-baseline'));
});
