const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parse } = require('node-html-parser');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'tests/fixtures/task-writer-eval');
const load = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false });
const base = () => require('./task-writer-eval.cjs');
const sha = (value) => createHash('sha256').update(value).digest('hex');

const LABEL_RULE = "\n\nChoose the existing label for the project the ticket is about, not a dependency or a project mentioned only as a comparison. Use only the board's provided label IDs; never invent a label, use a name as an ID, or fall back to the first label. If the project is unclear or ambiguous, suggest no project label. Preserve applicable existing generic labels. For HTML put comma-separated IDs in <span id=\"ai-generated-task-tags\" style=\"display:none\">. For structured tasks put each ticket's own IDs in its labelIds array; use an empty array when none apply.";
const PROMPT_FLAGS = ['HTPR-7500 old structure', 'HTPR-7977 short style', 'HTPR-7057 output language', 'board label rule'];
const PROMPT_FLAGS_EXCLUDED = ['HTPR-7060 research and empty-draft retry', 'HTPR-7123 ticket type', 'HTPR-7054 due date', 'compose-task split output'];
const PROCESS_LABEL = /^(?:brain-|flag:)/;
const BRAIN_LABEL = /^brain-/;
const CRITERIA = ['faithful', 'no_invented', 'board_style', 'actionable', 'length'];
const WRITER_MAX_OUTPUT_TOKENS = 16000;
const JUDGE_MAX_OUTPUT_TOKENS = 3000;

function modelPins() {
  const { getAiModelOptionById } = load(path.join(root, 'src/lib/aiModelOptions.ts'));
  const option = (id) => {
    const found = getAiModelOptionById(id);
    assert.ok(found?.directModel && found.providerOptions?.anthropic, `Unknown model option ${id}`);
    return found;
  };
  const sonnet = option('claude-sonnet-5-5-thinking');
  const haiku = option('claude-haiku-5-5');
  const instant = option('claude-sonnet-5-5-instant');
  return {
    haiku: { key: 'haiku', label: 'Haiku 5.5 low', directModel: haiku.directModel, openrouterModel: `anthropic/${haiku.model}`, providerOptions: { anthropic: { ...haiku.providerOptions.anthropic, effort: 'low' } } },
    sonnet: { key: 'sonnet', label: 'Sonnet 5.5 thinking', directModel: sonnet.directModel, openrouterModel: `anthropic/${sonnet.model}`, providerOptions: { anthropic: { ...sonnet.providerOptions.anthropic } } },
    judge: { key: 'judge', label: 'Sonnet 5.5 judge', directModel: instant.directModel, openrouterModel: `anthropic/${instant.model}`, providerOptions: { anthropic: { ...instant.providerOptions.anthropic } } },
  };
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function pool(items, size, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await task(items[index], index);
    }
  }));
  return out;
}

function stripLateAdditions(html) {
  const rootNode = parse(html);
  for (const node of [...rootNode.childNodes]) {
    const visible = (node.textContent ?? '').trim();
    if (/^(?:Flag:|Everyone:|On Everyone|On for Everyone|Tech detail:)/i.test(visible)) node.remove();
  }
  return rootNode.toString().replace(/\s*Pairs with <a [^>]*>[^<]*<\/a>\.?/g, '');
}

function validateGold(corpus, gold) {
  assert.ok(gold.fetchedAt && gold.boards && gold.cases, 'Gold file is incomplete');
  const real = corpus.cases.filter((c) => c.kind === 'real');
  assert.deepEqual(Object.keys(gold.cases).sort(), real.map((c) => c.id).sort(), 'Gold must cover exactly the real cases');
  for (const [id, entry] of Object.entries(gold.cases)) {
    assert.ok([15, 4060].includes(entry.projectId), `${id}: gold must come from an own board`);
    assert.ok(Array.isArray(entry.labels) && entry.labels.every((l) => typeof l === 'string'));
    assert.ok(entry.priority === null || [1, 2, 3, 4].includes(entry.priority), `${id}: priority`);
    assert.ok(entry.estimate === null || [2, 3, 4, 5, 6].includes(entry.estimate), `${id}: estimate`);
    assert.equal(typeof entry.fieldScored, 'boolean');
    if (entry.fieldScored) {
      const names = new Set(gold.boards[entry.projectId].labels.map((l) => l.name));
      for (const label of entry.labels) assert.ok(names.has(label), `${id}: label ${label} missing from board vocabulary`);
    }
  }
  assert.ok(!/\binne\b|funeral|wazig/i.test(JSON.stringify(gold)), 'Gold must not contain client text');
}

function styleRows(corpus, fixture, projectId, count = 3) {
  const candidates = corpus.cases.filter((c) => c.kind === 'real' && c.id !== fixture.id && c.source.url.includes(`/project-${projectId}/`));
  return candidates
    .map((c) => ({ c, rank: sha(`${fixture.id}:${c.id}`) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .slice(0, count)
    .map(({ c }) => ({
      projectId: Number(c.source.url.match(/project-(\d+)/)[1]),
      uniqueIndex: Number(c.source.url.match(/\/(\d+)$/)[1]),
      ticketNumber: c.id,
      title: c.title,
      descriptionText: base().text(c.reference),
      section: 'Done',
    }));
}

function assemble(corpus, gold, fixture, modelKey) {
  const prompts = load(path.join(root, 'src/app/api/ai/_lib/editorAiPrompts.ts'));
  const research = load(path.join(root, 'src/app/api/ai/_lib/taskWriterBoardResearch.ts'));
  const writerPrompt = load(path.join(root, 'src/app/api/ai/_lib/taskWriterPrompt.ts'));
  const { renderPrompt } = load(path.join(root, 'src/lib/ai/prompts/registry.ts'));
  const entry = gold.cases[fixture.id];
  const projectId = entry?.projectId ?? 15;
  const board = gold.boards[projectId];
  const authoringStyle = prompts.createTaskAuthoringStyle(false, true, false);
  const boardRules = renderPrompt('task-writer-board-research-web-old-structure-rules');
  const fixed = writerPrompt.createTaskWriterSystemPromptTemplate(`${authoringStyle}\n\n${boardRules}`);
  const suffix = `${LABEL_RULE}\n\n${renderPrompt('task-writer-output-language')}\n\n${renderPrompt('task-writer-short-style-rule')}`;
  const vocabulary = research.formatBoardVocabulary({ projectTitle: board.title, labels: board.labels });
  const visibleLabels = board.labels.filter((l) => vocabulary.includes(l.id)).length;
  const examples = research.formatStyleExamples(styleRows(corpus, fixture, projectId));
  const retrievedContext = writerPrompt.formatTaskWriterRetrievedContext({ currentTaskContext: '', relatedContext: '', styleExamples: examples, boardVocabulary: vocabulary });
  const { input } = prompts.createTaskWriterPromptParts({
    aiMode: 'AiTaskWriter',
    customInstructions: fixture.instructions ?? '',
    boardTemplates: [],
    modelSelected: modelKey,
    taskIds: [],
    taskDescription: '',
    taskTitle: fixture.title,
    retrievedContext,
    uploadedDocumentContext: '',
    input: fixture.notes,
    authoringStyle,
  });
  return {
    instructions: `${fixed}${suffix}`,
    input,
    styleText: base().text(examples),
    boardLabelIds: board.labels.map((l) => l.id),
    visibleLabels,
    totalLabels: board.labels.length,
  };
}

function parseDraft(fixture, raw, boardLabelIds) {
  const { extractTaskWriterProperties } = load(path.join(root, 'src/app/api/ai/_lib/taskWriterProperties.ts'));
  return extractTaskWriterProperties(raw, { boardLabelIds, fallbackTitle: fixture.title });
}

function scoreFields(goldEntry, board, properties) {
  const names = new Map(board.labels.map((l) => [l.id, l.name]));
  const predicted = (properties.labelIds ?? []).map((id) => names.get(id)).filter(Boolean);
  const set = (list, keep) => [...new Set(list.filter((n) => keep(n)))].sort();
  const blank = (value) => (value ? value : null);
  return {
    labels: { gold: set(goldEntry.labels, (n) => !PROCESS_LABEL.test(n)), predicted: set(predicted, (n) => !PROCESS_LABEL.test(n)) },
    brain: { gold: blank(set(goldEntry.labels, (n) => BRAIN_LABEL.test(n)).join(',')), predicted: blank(set(predicted, (n) => BRAIN_LABEL.test(n)).join(',')) },
    priority: { gold: goldEntry.priority ?? null, predicted: properties.priority > 0 ? properties.priority : null },
    size: { gold: goldEntry.estimate ?? null, predicted: properties.estimate > 0 ? properties.estimate : null },
  };
}

function exactStats(pairs) {
  const n = pairs.length;
  const hits = pairs.filter((p) => p.gold === p.predicted).length;
  const abstained = pairs.filter((p) => p.predicted === null);
  const rate = (a, b) => (b ? a / b : null);
  return {
    n,
    exact: rate(hits, n),
    alwaysBlank: rate(pairs.filter((p) => p.gold === null).length, n),
    abstainCount: abstained.length,
    abstainPrecision: rate(abstained.filter((p) => p.gold === null).length, abstained.length),
  };
}

function labelStats(rows) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let abstained = 0;
  let abstainedRight = 0;
  for (const { gold, predicted } of rows) {
    const g = new Set(gold);
    const p = new Set(predicted);
    for (const label of p) g.has(label) ? tp++ : fp++;
    for (const label of g) if (!p.has(label)) fn++;
    if (!p.size) {
      abstained++;
      if (!g.size) abstainedRight++;
    }
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall ? (2 * precision * recall) / (precision + recall) : tp + fp + fn ? 0 : null;
  return { n: rows.length, precision, recall, f1, abstainCount: abstained, abstainPrecision: abstained ? abstainedRight / abstained : null };
}

const JUDGE_SYSTEM = `You compare two versions of the same ticket for a software board. You see the original NOTES the ticket was written from, a few STYLE_EXAMPLES of how this board writes tickets, and two tickets labelled TICKET_1 and TICKET_2. You do not know which one a person wrote.
Judge only against the NOTES and the STYLE_EXAMPLES. For each criterion pick the better ticket ("1" or "2") or "tie":
- faithful: keeps every concrete requirement, fact and link of the NOTES.
- no_invented: has fewer facts that are not in the NOTES.
- board_style: reads like the STYLE_EXAMPLES in structure, tone and wording.
- actionable: a builder knows what to do and when it is done.
- length: right length for the content, no padding, nothing needed is missing.
Also pick "overall". An invented fact is a number, name, behaviour, decision or link that the NOTES do not state or clearly imply. Rewording, headings and obvious wording are not invented. List each invented fact as a short string per ticket.
Answer with one JSON object and nothing else, shaped exactly as {"faithful":"1","no_invented":"1","board_style":"1","actionable":"1","length":"1","overall":"1","invented_1":[],"invented_2":[]}.`;

function judgeInput(notes, styleText, first, second) {
  return `<NOTES>\n${notes}\n</NOTES>\n\n<STYLE_EXAMPLES>\n${styleText || 'none'}\n</STYLE_EXAMPLES>\n\n<TICKET_1>\n${first}\n</TICKET_1>\n\n<TICKET_2>\n${second}\n</TICKET_2>`;
}

function parseVerdict(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const verdict = JSON.parse(cleaned);
  for (const key of [...CRITERIA, 'overall']) assert.ok(['1', '2', 'tie'].includes(verdict[key]), `Judge verdict ${key} invalid`);
  for (const key of ['invented_1', 'invented_2']) assert.ok(Array.isArray(verdict[key]) && verdict[key].every((s) => typeof s === 'string'), `Judge ${key} invalid`);
  return verdict;
}

async function judgeOrder(generate, judgeModel, args, writerFirst) {
  const first = writerFirst ? args.draft : args.reference;
  const second = writerFirst ? args.reference : args.draft;
  const request = { model: judgeModel, instructions: JUDGE_SYSTEM, input: judgeInput(args.notes, args.styleText, first, second), maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS };
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await generate(request);
      const verdict = parseVerdict(reply.text);
      const writer = writerFirst ? '1' : '2';
      const side = (value) => (value === 'tie' ? 'tie' : value === writer ? 'writer' : 'real');
      return {
        ...Object.fromEntries([...CRITERIA, 'overall'].map((key) => [key, side(verdict[key])])),
        inventedWriter: writerFirst ? verdict.invented_1 : verdict.invented_2,
        inventedReal: writerFirst ? verdict.invented_2 : verdict.invented_1,
      };
    } catch (error) {
      lastError = error;
    }
  }
  return { error: String(lastError?.message ?? lastError).slice(0, 200) };
}

function consensus(a, b) {
  return a === b ? a : 'tie';
}

async function judgeCase(generate, judgeModel, args) {
  const [forward, reverse] = await Promise.all([judgeOrder(generate, judgeModel, args, true), judgeOrder(generate, judgeModel, args, false)]);
  if (forward.error || reverse.error) return { error: forward.error ?? reverse.error };
  const result = Object.fromEntries([...CRITERIA, 'overall'].map((key) => [key, consensus(forward[key], reverse[key])]));
  return {
    ...result,
    inventedWriterBoth: forward.inventedWriter.length > 0 && reverse.inventedWriter.length > 0,
    inventedWriterEither: forward.inventedWriter.length > 0 || reverse.inventedWriter.length > 0,
    inventedRealBoth: forward.inventedReal.length > 0 && reverse.inventedReal.length > 0,
    inventedRealEither: forward.inventedReal.length > 0 || reverse.inventedReal.length > 0,
  };
}

async function runCase(env, model, fixture) {
  const { corpus, gold, generate, judgeModel, judge } = env;
  const prepared = assemble(corpus, gold, fixture, model.directModel);
  const row = { id: fixture.id, model: model.key, visibleLabels: prepared.visibleLabels, totalLabels: prepared.totalLabels, promptSha: sha(prepared.instructions) };
  const started = Date.now();
  let reply;
  try {
    reply = await generate({ model, instructions: prepared.instructions, input: prepared.input, maxOutputTokens: WRITER_MAX_OUTPUT_TOKENS });
  } catch (error) {
    return { ...row, error: String(error?.message ?? error).slice(0, 200) };
  }
  row.latencyMs = Date.now() - started;
  row.inputTokens = reply.inputTokens ?? null;
  row.outputTokens = reply.outputTokens ?? null;
  const properties = parseDraft(fixture, reply.text, prepared.boardLabelIds);
  row.title = properties.title;
  row.description = properties.description;
  row.rules = base().scoreWriter(fixture, properties.description);
  const goldEntry = gold.cases[fixture.id];
  if (goldEntry?.fieldScored) row.fields = scoreFields(goldEntry, gold.boards[goldEntry.projectId], properties);
  if (judge && properties.description.trim()) {
    row.judge = await judgeCase(generate, judgeModel, {
      notes: fixture.notes,
      styleText: prepared.styleText,
      draft: properties.description,
      reference: stripLateAdditions(fixture.reference),
    });
  }
  return row;
}

function aggregate(rows, referenceRows) {
  const ok = rows.filter((r) => !r.error);
  const scored = ok.filter((r) => r.fields);
  const judged = ok.filter((r) => r.judge && !r.judge.error);
  const share = (list, pick) => (list.length ? list.filter(pick).length / list.length : null);
  const tally = (key) => ({
    win: share(judged, (r) => r.judge[key] === 'writer'),
    tie: share(judged, (r) => r.judge[key] === 'tie'),
    loss: share(judged, (r) => r.judge[key] === 'real'),
  });
  return {
    cases: rows.length,
    errors: rows.length - ok.length,
    writerErrorSamples: rows.filter((r) => r.error).slice(0, 3).map((r) => `${r.id}: ${r.error}`),
    rules: { cleanRate: share(ok, (r) => r.rules.violations.length === 0), violations: ok.reduce((n, r) => n + r.rules.violations.length, 0), wordsP50: median(ok.map((r) => r.rules.words)) },
    labels: labelStats(scored.map((r) => r.fields.labels)),
    brain: exactStats(scored.map((r) => r.fields.brain)),
    priority: exactStats(scored.map((r) => r.fields.priority)),
    size: exactStats(scored.map((r) => r.fields.size)),
    judge: {
      judged: judged.length,
      judgeErrors: ok.filter((r) => r.judge?.error).length,
      overall: tally('overall'),
      criteria: Object.fromEntries(CRITERIA.map((key) => [key, tally(key)])),
      inventedWriterBoth: share(judged, (r) => r.judge.inventedWriterBoth),
      inventedWriterEither: share(judged, (r) => r.judge.inventedWriterEither),
      inventedRealBoth: share(judged, (r) => r.judge.inventedRealBoth),
      inventedRealEither: share(judged, (r) => r.judge.inventedRealEither),
    },
    cost: {
      inputTokensP50: median(ok.map((r) => r.inputTokens)),
      outputTokensP50: median(ok.map((r) => r.outputTokens)),
      latencyMsP50: median(ok.map((r) => r.latencyMs)),
    },
    vocabulary: { labelsVisible: ok[0]?.visibleLabels ?? null, labelsTotal: ok[0]?.totalLabels ?? null },
  };
}

function flatten(summary, prefix = '') {
  return Object.entries(summary).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'number') return [[name, value]];
    if (value && typeof value === 'object' && !Array.isArray(value)) return flatten(value, name);
    return [];
  });
}

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
const num = (v) => (v === null || v === undefined ? 'n/a' : String(Math.round(v)));

function renderReport(result, previous) {
  const keys = Object.keys(result.models);
  const header = (title) => `\n### ${title}\n| metric | ${keys.map((k) => result.models[k].label).join(' | ')} |\n|---|${keys.map(() => '---').join('|')}|`;
  const line = (name, fn) => `| ${name} | ${keys.map((k) => fn(result.models[k].summary, k)).join(' | ')} |`;
  const delta = (k, path) => {
    const before = previous?.models?.[k]?.summary && flatten(previous.models[k].summary).find(([name]) => name === path)?.[1];
    const now = flatten(result.models[k].summary).find(([name]) => name === path)?.[1];
    return before === undefined || now === undefined ? '' : ` (${now - before >= 0 ? '+' : ''}${(now - before).toFixed(2)})`;
  };
  const field = (name, key) => line(name, (s, k) => `${pct(s[key].exact)} of ${s[key].n}, always blank ${pct(s[key].alwaysBlank)}, abstain precision ${pct(s[key].abstainPrecision)} (${s[key].abstainCount} blank)${delta(k, `${key}.exact`)}`);
  const verdict = (name, key) => line(name, (s) => `${pct(s.judge.criteria[key].win)} / ${pct(s.judge.criteria[key].tie)} / ${pct(s.judge.criteria[key].loss)}`);
  return [
    `## Task Writer pinned eval (report only, one trial)`,
    `corpus ${result.corpusHash.slice(0, 12)}, gold fetched ${result.goldFetchedAt}, prompt flags on: ${result.promptFlags.join(', ')}`,
    `prompt sha256 ${result.promptSha.slice(0, 12)}, judge ${result.judgeLabel}, ${result.cases} cases per model, a few cases make every rate noisy`,
    header('Fields (scored on board 15 real cases)'),
    line('labels F1 (precision / recall)', (s, k) => `${pct(s.labels.f1)} (${pct(s.labels.precision)} / ${pct(s.labels.recall)}), abstain precision ${pct(s.labels.abstainPrecision)} (${s.labels.abstainCount} blank), n ${s.labels.n}${delta(k, 'labels.f1')}`),
    field('brain label exact', 'brain'),
    field('priority exact', 'priority'),
    field('size exact', 'size'),
    header('Judge vs the real ticket (win / tie / loss, both orders must agree)'),
    line('overall', (s, k) => `${pct(s.judge.overall.win)} / ${pct(s.judge.overall.tie)} / ${pct(s.judge.overall.loss)} of ${s.judge.judged}${delta(k, 'judge.overall.win')}`),
    verdict('faithful', 'faithful'),
    verdict('no invented facts', 'no_invented'),
    verdict('board style', 'board_style'),
    verdict('actionable', 'actionable'),
    verdict('length', 'length'),
    line('invented-fact rate, writer (both orders / either)', (s) => `${pct(s.judge.inventedWriterBoth)} / ${pct(s.judge.inventedWriterEither)}`),
    line('invented-fact rate, real ticket (calibration)', (s) => `${pct(s.judge.inventedRealBoth)} / ${pct(s.judge.inventedRealEither)}`),
    header('Rules, cost and speed'),
    line('rule checks clean', (s) => `${pct(s.rules.cleanRate)} (${s.rules.violations} violations), words p50 ${num(s.rules.wordsP50)}`),
    line('input tokens p50', (s) => num(s.cost.inputTokensP50)),
    line('output tokens p50', (s) => num(s.cost.outputTokensP50)),
    line('latency p50 (ms)', (s) => num(s.cost.latencyMsP50)),
    line('errors (writer / judge)', (s) => `${s.errors} / ${s.judge.judgeErrors}`),
    line('board labels the writer can see', (s) => `${s.vocabulary.labelsVisible} of ${s.vocabulary.labelsTotal}`),
  ].join('\n');
}

async function runPinned({ corpus, gold, generate, pins, models, concurrency = 3, judge = true, limit }) {
  base().validateCorpus(corpus);
  validateGold(corpus, gold);
  const fixtures = limit ? corpus.cases.slice(0, limit) : corpus.cases;
  const env = { corpus, gold, generate, judgeModel: pins.judge, judge };
  const jobs = models.flatMap((key) => fixtures.map((fixture) => ({ model: pins[key], fixture })));
  const rows = await pool(jobs, concurrency * models.length, ({ model, fixture }) => runCase(env, model, fixture));
  const result = { corpusHash: base().digest(corpus), goldFetchedAt: gold.fetchedAt, promptFlags: PROMPT_FLAGS, promptFlagsExcluded: PROMPT_FLAGS_EXCLUDED, judgeLabel: pins.judge.label, cases: fixtures.length, models: {} };
  for (const key of models) {
    const own = rows.filter((r) => r.model === key);
    result.models[key] = { label: pins[key].label, directModel: pins[key].directModel, providerOptions: pins[key].providerOptions, summary: aggregate(own), rows: own };
  }
  result.promptSha = sha(rows.map((r) => r.promptSha).filter(Boolean).sort().join(','));
  return result;
}

async function sdkGenerate(apiKey, fetch = globalThis.fetch) {
  const { generateText } = await import('ai');
  const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
  const openrouter = createOpenRouter({ apiKey, fetch });
  return async ({ model, instructions, input, maxOutputTokens }) => {
    const options = model.providerOptions.anthropic;
    const result = await generateText({
      model: openrouter.chat(model.openrouterModel, {
        provider: { only: ['anthropic'], allow_fallbacks: false, require_parameters: true },
        reasoning: options.thinking.type === 'disabled'
          ? { enabled: false, effort: 'none' }
          : { enabled: true, effort: options.effort },
      }),
      instructions,
      messages: [{ role: 'user', content: input }],
      maxOutputTokens,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(300000),
    });
    return { text: result.text, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens };
  };
}

async function main() {
  const apiKey = process.env.OPENROUTER_EVAL_KEY;
  assert.ok(apiKey, 'The pinned eval requires OPENROUTER_EVAL_KEY');
  const output = process.env.WRITER_EVAL_OUTPUT;
  assert.ok(output && !path.resolve(output).startsWith(directory + path.sep), 'Save pinned output outside committed fixtures; promote only after review');
  fs.mkdirSync(output, { recursive: true });
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const models = (arg('models') ?? 'haiku,sonnet').split(',');
  const corpus = JSON.parse(fs.readFileSync(path.join(directory, 'cases.json'), 'utf8'));
  const gold = JSON.parse(fs.readFileSync(path.join(directory, 'gold.json'), 'utf8'));
  const baselinePath = path.join(directory, 'pinned-baseline.json');
  const previous = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
  const result = await runPinned({
    corpus, gold, pins: modelPins(), models,
    generate: await sdkGenerate(apiKey),
    concurrency: Number(arg('concurrency') ?? 3),
    judge: !process.argv.includes('--no-judge'),
    limit: arg('limit') ? Number(arg('limit')) : undefined,
  });
  const report = renderReport(result, previous);
  fs.writeFileSync(path.join(output, 'pinned-scores.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'pinned-report.md'), report + '\n');
  console.log(report);
  if (process.argv.includes('--save-baseline')) {
    const metrics = { corpusHash: result.corpusHash, promptSha: result.promptSha, models: Object.fromEntries(Object.entries(result.models).map(([k, v]) => [k, { label: v.label, summary: v.summary }])) };
    fs.writeFileSync(baselinePath, JSON.stringify(metrics, null, 2) + '\n');
  }
  for (const [key, model] of Object.entries(result.models)) assert.ok(model.summary.errors < model.summary.cases, `${key}: every case failed: ${model.summary.writerErrorSamples.join('; ')}`);
}

module.exports = { main, sdkGenerate, modelPins, renderReport, runPinned, scoreFields, exactStats, labelStats, stripLateAdditions, validateGold, styleRows, assemble, parseVerdict, judgeCase, aggregate, median, LABEL_RULE, JUDGE_SYSTEM };
