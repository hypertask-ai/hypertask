const test = require('node:test');
const assert = require('node:assert/strict');
const { text, scoreWriter, scoreChips, compareBaseline, replay, runLive, validateCorpus, digest } = require('../scripts/task-writer-eval.cjs');
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


test('live quality deltas expose worsening writer and chip scores separately', () => {
  const baseline = [{ id: 'a', writer: { violations: ['known'] }, chips: { violations: [] } }];
  assert.deepEqual(compareBaseline(baseline, baseline), { writer: { baseline: 1, current: 1, delta: 0 }, chips: { baseline: 0, current: 0, delta: 0 } });
  const worse = structuredClone(baseline); worse[0].writer.violations.push('new');
  assert.deepEqual(compareBaseline(worse, baseline).writer, { baseline: 1, current: 2, delta: 1 });
  const chips = structuredClone(baseline); chips[0].chips.violations.push('existing-section');
  assert.deepEqual(compareBaseline(chips, baseline).chips, { baseline: 0, current: 1, delta: 1 });
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
  assert.match(live.if, /workflow_dispatch' && !inputs\.pinned/);
  assert.ok(!live.if.includes("github.event_name == 'pull_request'"));
  assert.equal(live['timeout-minutes'], 20);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const candidate = yaml.load(fs.readFileSync('.github/workflows/ai-evals.yml', 'utf8')).jobs['ai-evals'];
  assert.ok(!JSON.stringify(candidate).includes('secrets.QA_'));
  assert.ok(candidate.steps.some((step) => step.run === 'node scripts/task-writer-eval.cjs --verify-baseline'));
});


test('word measurement uses parsed visible blocks and ignores script/style text', () => {
  assert.equal(text('<p>one &amp; two</p><p>three</p>'), 'one & two three');
  assert.equal(text('<script>alert(1)</script><p>real text</p><style>body {}</style>'), 'real text');
  assert.equal(text('<p>up<strong>date</strong> kept</p>'), 'update kept');
  assert.ok(scoreWriter(simple, '<script>alert(1)</script ><p>real text</p>').violations.includes('empty-draft'));
});


test('addition targets exclude section names used only as placement references', () => {
  assert.deepEqual(scoreChips(simple, good, ['Add a Goal heading above the Problem section'], []).violations, []);
  assert.deepEqual(scoreChips(simple, good, ['Add a Problem heading above Done when'], []).violations, ['0:existing-section:problem']);
  assert.deepEqual(scoreWriter(simple, good + '<h2>ICE assessment (estimated)</h2><p>21/30</p>').violations, ['forbidden:ICE']);
  assert.deepEqual(scoreWriter(simple, good + '<h2>ICE score: 21/30</h2>').violations, ['forbidden:ICE']);
});

const pinned = require('../scripts/task-writer-eval-pinned.cjs');
const gold = require('./fixtures/task-writer-eval/gold.json');
const fs = require('node:fs');
const path = require('node:path');

test('pinned requests use the approved OpenRouter models, reasoning and no provider fallback', async () => {
  const requests = [];
  const generate = await pinned.sdkGenerate('test-eval-key', async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      id: 'eval-test', created: 1, model: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'draft' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }), { headers: { 'content-type': 'application/json' } });
  });
  const pins = pinned.modelPins();
  for (const model of [pins.haiku, pins.sonnet, pins.judge]) {
    const result = await generate({ model, instructions: 'Write a ticket', input: 'Fix typo', maxOutputTokens: 20 });
    assert.equal(result.text, 'draft');
    assert.equal(result.inputTokens, 10);
    assert.equal(result.outputTokens, 2);
  }
  assert.deepEqual(requests.map(({ body }) => body.model), [
    'anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-sonnet-5.5',
  ]);
  assert.deepEqual(requests.map(({ body }) => body.reasoning), [
    { enabled: true, effort: 'low' }, { enabled: true, effort: 'high' }, { enabled: false, effort: 'none' },
  ]);
  for (const { url, body } of requests) {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(body.provider, { only: ['anthropic'], allow_fallbacks: false, require_parameters: true });
    assert.ok(body.messages.some((message) => message.role === 'system' && [message.content].flat().some((part) => (part?.text ?? part) === 'Write a ticket')));
    assert.ok(body.messages.some((message) => message.role === 'user' && message.content === 'Fix typo'));
  }
});

test('label scoring ignores process labels and counts abstaining on a blank gold as right', () => {
  const rows = [
    { gold: ['Bug', 'INBOX'], predicted: ['Bug', 'Billing'] },
    { gold: [], predicted: [] },
    { gold: ['Billing'], predicted: [] },
  ];
  const stats = pinned.labelStats(rows);
  assert.equal(stats.precision, 0.5);
  assert.ok(Math.abs(stats.recall - 1 / 3) < 1e-9);
  assert.ok(Math.abs(stats.f1 - 0.4) < 1e-9);
  assert.equal(stats.abstainCount, 2);
  assert.equal(stats.abstainPrecision, 0.5);
  const fields = pinned.scoreFields(
    { labels: ['Bug', 'brain-hard', 'flag:x'], priority: 2, estimate: null },
    { labels: [{ id: 'a', name: 'Bug' }, { id: 'b', name: 'brain-hard' }, { id: 'c', name: 'Billing' }] },
    { labelIds: ['a', 'b', 'c'], priority: 0, estimate: 4 }
  );
  assert.deepEqual(fields.labels, { gold: ['Bug'], predicted: ['Billing', 'Bug'] });
  assert.deepEqual(fields.brain, { gold: 'brain-hard', predicted: 'brain-hard' });
  assert.deepEqual(fields.priority, { gold: 2, predicted: null });
  assert.deepEqual(fields.size, { gold: null, predicted: 4 });
});

test('exact-match fields report the always-blank baseline and abstain precision', () => {
  const stats = pinned.exactStats([
    { gold: null, predicted: null },
    { gold: 2, predicted: null },
    { gold: 3, predicted: 3 },
    { gold: null, predicted: 4 },
  ]);
  assert.equal(stats.n, 4);
  assert.equal(stats.exact, 0.5);
  assert.equal(stats.alwaysBlank, 0.5);
  assert.equal(stats.abstainCount, 2);
  assert.equal(stats.abstainPrecision, 0.5);
  assert.equal(pinned.exactStats([]).exact, null);
});

test('late-added reference lines are stripped before judging', () => {
  const html = '<p>Why. Real text.</p><p>Flag: <a href="https://x">f</a></p><p>Everyone: No.</p><p>On Everyone now.</p><p>Tech detail: see log.</p><p>Done when. Pairs with <a href="https://x/1">HTPR-1</a>. Keep.</p>';
  assert.equal(text(pinned.stripLateAdditions(html)), 'Why. Real text. Done when. Keep.');
});

test('judge counts a win or loss only when both orders agree and parses strict JSON', async () => {
  const verdict = (pick) => JSON.stringify({ faithful: pick, no_invented: pick, board_style: pick, actionable: pick, length: pick, overall: pick, invented_1: [], invented_2: [] });
  const args = { notes: 'n', styleText: '', draft: '<p>draft</p>', reference: '<p>ref</p>' };
  const always1 = await pinned.judgeCase(async () => ({ text: verdict('1') }), { key: 'judge' }, args);
  assert.equal(always1.overall, 'tie');
  const writerWins = await pinned.judgeCase(async (request) => ({ text: verdict(request.input.indexOf('draft') < request.input.indexOf('ref') ? '1' : '2') }), { key: 'judge' }, args);
  assert.equal(writerWins.overall, 'writer');
  assert.equal(writerWins.faithful, 'writer');
  const broken = await pinned.judgeCase(async () => ({ text: 'not json' }), { key: 'judge' }, args);
  assert.ok(broken.error);
  assert.throws(() => pinned.parseVerdict('{"overall":"3"}'));
  assert.equal(pinned.parseVerdict('```json\n' + verdict('tie') + '\n```').overall, 'tie');
});

test('judge flags invented facts per ticket in both orders', async () => {
  const generate = async (request) => {
    const draftFirst = request.input.indexOf('draft') < request.input.indexOf('ref');
    return { text: JSON.stringify({ faithful: 'tie', no_invented: 'tie', board_style: 'tie', actionable: 'tie', length: 'tie', overall: 'tie', invented_1: draftFirst ? ['x'] : [], invented_2: draftFirst ? [] : ['x'] }) };
  };
  const result = await pinned.judgeCase(generate, { key: 'judge' }, { notes: 'n', styleText: '', draft: '<p>draft</p>', reference: '<p>ref</p>' });
  assert.equal(result.inventedWriterBoth, true);
  assert.equal(result.inventedRealEither, false);
});

test('gold fields cover exactly the real cases, come from our own boards and carry no client text', () => {
  pinned.validateGold(corpus, gold);
  assert.ok(Object.values(gold.cases).some((entry) => entry.fieldScored));
  assert.ok(Object.values(gold.cases).every((entry) => !entry.fieldScored || entry.projectId === 15));
});

test('pinned run reports every metric with a fake model and survives failed cases', async () => {
  const generate = async (request) => {
    if (request.instructions.startsWith('You compare')) return { text: JSON.stringify({ faithful: 'tie', no_invented: 'tie', board_style: 'tie', actionable: 'tie', length: 'tie', overall: 'tie', invented_1: [], invented_2: [] }) };
    if (request.model.key === 'sonnet') throw new Error('boom');
    return { text: '<span id="ai-generated-task-title">T</span><h2>Why</h2><p>hi</p><span id="ai-generated-task-priority">2</span>', inputTokens: 1000, outputTokens: 50 };
  };
  const pins = { haiku: { key: 'haiku', label: 'Haiku', directModel: 'h' }, sonnet: { key: 'sonnet', label: 'Sonnet', directModel: 's' }, judge: { key: 'judge', label: 'Judge', directModel: 'j' } };
  const result = await pinned.runPinned({ corpus, gold, generate, pins, models: ['haiku', 'sonnet'], limit: 4 });
  assert.equal(result.models.haiku.summary.errors, 0);
  assert.equal(result.models.haiku.summary.cost.inputTokensP50, 1000);
  assert.equal(result.models.sonnet.summary.errors, 4);
  assert.match(pinned.renderReport(result, null), /input tokens p50/);
});

test('the pinned prompt keeps the product label rule verbatim', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/api/ai/_lib/taskWriterRun.ts'), 'utf8');
  const rule = pinned.LABEL_RULE.trim().replaceAll('"', '\\"');
  assert.ok(source.includes(rule), 'taskWriterRun.ts label rule drifted from the pinned eval');
});

test('pinned prompt assembles from the real builders with the board vocabulary and leave-one-out examples', () => {
  const fixture = corpus.cases.find((c) => c.id === 'HTPR-7982');
  const prepared = pinned.assemble(corpus, gold, fixture, 'claude-haiku-5-5');
  assert.ok(prepared.instructions.includes('Choose the existing label for the project'));
  assert.ok(prepared.input.includes('<STYLE_EXAMPLES>'));
  assert.ok(!prepared.input.includes('example:4'));
  assert.ok(!prepared.styleText.includes('project-15/7982'));
  assert.ok(prepared.visibleLabels > 0 && prepared.visibleLabels <= prepared.totalLabels);
  assert.equal(pinned.assemble(corpus, gold, fixture, 'claude-haiku-5-5').input, prepared.input);
});
