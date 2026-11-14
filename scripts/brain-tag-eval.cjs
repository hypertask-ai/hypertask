#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const CORPUS = path.resolve(__dirname, '../tests/fixtures/brain-tag-eval/corpus.json');
const LEVELS = ['brain-light', 'brain-medium', 'brain-hard', 'brain-extra-hard'];
const NUMBER = new Map(LEVELS.map((level, index) => [level, index]));
const JEV_MODEL = 'typesafe/jev-1.14';
const HAIKU_MODEL = 'claude-haiku-5-5';
const HAIKU_PROVIDER_OPTIONS = { anthropic: { thinking: { type: 'adaptive' }, effort: 'medium' } };
const CONFIDENT = 0.7;
const KEEP_MARGIN = 0.05;

const CRITERIA = {
  light: 'A tiny fix in one file: a typo, a wording change or a one-line tweak.',
  medium: 'Normal work: a feature, a bug fix or a change of a few files, with no security, money or data-loss risk.',
  hard: 'A hard bug, security, money, payments, data loss, or work that touches many systems.',
  'extra-hard': 'Rare: auth or security together with money.',
};

const HAIKU_INSTRUCTIONS = [
  'You label the work difficulty of one software ticket.',
  'Pick exactly one brain label for the ticket, from how hard the work is:',
  '- brain-light: a tiny fix in one file, such as a typo, a wording change or a one-line tweak.',
  '- brain-medium: the default for normal work, such as a feature, a bug fix or a change of a few files with no security, money or data-loss risk.',
  '- brain-hard: a hard bug, security, money, payments, data loss, or work across many systems.',
  '- brain-extra-hard: rare, auth or security together with money.',
  'If you are unsure between medium and hard, pick brain-medium.',
  'Answer with exactly one of these four words and nothing else: light, medium, hard, extra-hard.',
].join('\n');

const sha = (value) => createHash('sha256').update(value).digest('hex');

function normaliseAnswer(raw) {
  const text = String(raw ?? '').toLowerCase().replace(/[^a-z-]+/g, ' ');
  const found = LEVELS.map((level) => [level, text.indexOf(level.replace('brain-', ''))]).filter(([, index]) => index >= 0);
  if (!found.length) return null;
  found.sort((a, b) => a[1] - b[1]);
  return found[0][0];
}

function parseJevAnswer(body) {
  const answer = body?.answers?.brain;
  if (!answer || answer.type !== 'choice') return { error: String(body?.error?.message ?? 'no brain answer').slice(0, 200) };
  const level = `brain-${String(answer.choice ?? '').trim().toLowerCase()}`;
  if (!NUMBER.has(level)) return { error: `unknown choice ${answer.choice}` };
  return { level, confidence: typeof answer.confidence === 'number' ? answer.confidence : null, probabilities: answer.probabilities ?? null };
}

function jevRequest(testCase) {
  return {
    model: JEV_MODEL,
    session_id: 'htpr-9044-brain-tag-eval',
    provider: { zdr: true, only: ['typesafe'], data_collection: 'deny' },
    state: { title: testCase.title, text: testCase.text },
    questions: { brain: { type: 'choice', instructions: 'How hard is the work in this ticket?', criteria: CRITERIA } },
  };
}

function haikuPrompts(testCase) {
  return { instructions: HAIKU_INSTRUCTIONS, input: `TICKET\nTitle: ${testCase.title}\n\n${testCase.text}\n\nAnswer with one word.` };
}

function percentile(values, fraction) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function scoreModel(rows) {
  const answered = rows.filter((row) => row.predicted);
  const exact = answered.filter((row) => row.predicted === row.gold).length;
  const withinOne = answered.filter((row) => Math.abs(NUMBER.get(row.predicted) - NUMBER.get(row.gold)) <= 1).length;
  const perClass = LEVELS.map((gold) => {
    const own = answered.filter((row) => row.gold === gold);
    return { gold, n: own.length, exact: own.length ? own.filter((row) => row.predicted === gold).length / own.length : null };
  }).filter((entry) => entry.n > 0);
  const confident = answered.filter((row) => typeof row.confidence === 'number' && row.confidence >= CONFIDENT);
  const confusion = Object.fromEntries(LEVELS.map((gold) => [gold, Object.fromEntries(LEVELS.map((predicted) => [predicted, 0]))]));
  for (const row of answered) confusion[row.gold][row.predicted] += 1;
  const latencies = rows.map((row) => row.latencyMs).filter((value) => Number.isFinite(value));
  return {
    cases: rows.length,
    errors: rows.length - answered.length,
    answered: answered.length,
    exact: answered.length ? exact / answered.length : null,
    macroExact: perClass.length ? perClass.reduce((sum, entry) => sum + entry.exact, 0) / perClass.length : null,
    withinOne: answered.length ? withinOne / answered.length : null,
    perClass,
    confident: {
      threshold: CONFIDENT,
      count: confident.length,
      coverage: answered.length ? confident.length / answered.length : null,
      exact: confident.length ? confident.filter((row) => row.predicted === row.gold).length / confident.length : null,
    },
    latencyMs: { p50: percentile(latencies, 0.5), p90: percentile(latencies, 0.9) },
    costUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    confusion,
    errorSamples: rows.filter((row) => row.error).slice(0, 3).map((row) => `${row.id}: ${row.error}`),
  };
}

function alwaysMedium(rows) {
  return scoreModel(rows.map((row) => ({ ...row, predicted: 'brain-medium', confidence: null, latencyMs: null })));
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function paired(jevRows, haikuRows, samples = 5000) {
  const haikuById = new Map(haikuRows.map((row) => [row.id, row]));
  const pairs = jevRows
    .filter((row) => row.predicted && haikuById.get(row.id)?.predicted)
    .map((row) => {
      const other = haikuById.get(row.id);
      return { jev: row.predicted === row.gold ? 1 : 0, haiku: other.predicted === row.gold ? 1 : 0 };
    });
  const n = pairs.length;
  const jevExact = pairs.reduce((sum, pair) => sum + pair.jev, 0) / n;
  const haikuExact = pairs.reduce((sum, pair) => sum + pair.haiku, 0) / n;
  const jevOnly = pairs.filter((pair) => pair.jev && !pair.haiku).length;
  const haikuOnly = pairs.filter((pair) => pair.haiku && !pair.jev).length;
  const discordant = jevOnly + haikuOnly;
  let oneSided = 0;
  for (let i = jevOnly; i <= discordant; i++) oneSided += combination(discordant, i) / 2 ** discordant;
  const differences = pairs.map((pair) => pair.jev - pair.haiku);
  const random = seeded(9044);
  const boots = Array.from({ length: samples }, () => {
    const draw = differences.map(() => differences[Math.floor(random() * n)]);
    return draw.reduce((sum, value) => sum + value, 0) / n;
  }).sort((a, b) => a - b);
  const at = (fraction) => boots[Math.min(boots.length - 1, Math.max(0, Math.ceil(fraction * boots.length) - 1))];
  const both = pairs.filter((pair) => pair.jev && pair.haiku).length;
  const coverage = jevRows.length ? pairs.length / jevRows.length : 0;
  const jevHits = pairs.reduce((sum, pair) => sum + pair.jev, 0);
  const haikuHits = pairs.reduce((sum, pair) => sum + pair.haiku, 0);
  return { n, coverage, jevHits, haikuHits, gap: (jevHits - haikuHits) / n, jevExact, haikuExact, jevOnly, haikuOnly, both, neither: n - both - discordant, discordant, oneSided, ci95: [at(0.025), at(0.975)] };
}

function combination(n, k) {
  let value = 1;
  for (let i = 1; i <= k; i++) value = (value * (n - k + i)) / i;
  return value;
}

function verdict(jev, haiku, today, pairs, repeats) {
  const gaps = (repeats ?? []).map((repeat) => repeat.gap);
  const meanGap = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
  const spread = gaps.length ? `${signed(Math.min(...gaps))} to ${signed(Math.max(...gaps))} over ${gaps.length} runs` : 'one run';
  const bars = [
    {
      name: 'jev beats haiku by 5 points exact, and the interval clears zero',
      pass: meanGap !== null && meanGap >= KEEP_MARGIN - 1e-9 && Boolean(pairs) && pairs.ci95[0] > 0,
      detail: `mean gap ${signed(meanGap ?? 0)} points (${spread})${pairs ? `, 95% CI of the first run ${signed(pairs.ci95[0])} to ${signed(pairs.ci95[1])}` : ''}`,
    },
    { name: 'haiku answered nearly every ticket', pass: haiku.errors / Math.max(1, haiku.cases) <= 0.02, detail: `${haiku.errors} of ${haiku.cases} haiku calls failed` },
    { name: 'both models answered the same tickets', pass: (pairs?.coverage ?? 0) >= 0.98, detail: `${pct(pairs?.coverage ?? null)} of tickets compared` },
    { name: 'jev beats the always-medium default', pass: jev.exact !== null && today.exact !== null && jev.exact - today.exact >= KEEP_MARGIN, detail: `${pct(jev.exact)} vs ${pct(today.exact)}` },
    { name: 'jev is not slower than haiku', pass: jev.latencyMs.p50 !== null && haiku.latencyMs.p50 !== null && jev.latencyMs.p50 <= haiku.latencyMs.p50, detail: `p50 ${jev.latencyMs.p50}ms vs ${haiku.latencyMs.p50}ms` },
    { name: 'jev answers nearly every ticket', pass: jev.cases > 0 && jev.errors / jev.cases <= 0.02, detail: `${jev.errors} of ${jev.cases} failed` },
  ];
  return { keep: bars.every((bar) => bar.pass), bars };
}

function assemble(corpus, models, startedAt, jevRuns, haikuRuns) {
  const runs = {
    jev: Array.isArray(jevRuns[0]) ? jevRuns : [jevRuns],
    haiku: Array.isArray(haikuRuns[0]) ? haikuRuns : [haikuRuns],
  };
  const count = Math.min(runs.jev.length, runs.haiku.length);
  const repeats = Array.from({ length: count }, (_, index) => {
    const pairs = paired(runs.jev[index], runs.haiku[index]);
    return { jevHits: pairs.jevHits, haikuHits: pairs.haikuHits, n: pairs.n, gap: pairs.gap, ci95: pairs.ci95, oneSided: pairs.oneSided, discordant: pairs.discordant, jevOnly: pairs.jevOnly, haikuOnly: pairs.haikuOnly, both: pairs.both, neither: pairs.neither };
  });
  const jev = scoreModel(runs.jev.flat());
  const haiku = scoreModel(runs.haiku.flat());
  const today = alwaysMedium(runs.haiku.flat());
  return {
    startedAt,
    corpus,
    models,
    promptSha: { jev: sha(JSON.stringify(CRITERIA)), haiku: sha(HAIKU_INSTRUCTIONS) },
    jev,
    haiku,
    today,
    repeats,
    verdict: verdict(jev, haiku, today, repeats[0], repeats),
    rows: runs,
  };
}

const pct = (value) => (value === null || value === undefined ? 'n/a' : `${Math.round(value * 100)}%`);
const signed = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}`;

function renderReport(result) {
  const { jev, haiku, today, corpus } = result;
  const row = (name, fn) => `| ${name} | ${fn(jev)} | ${fn(haiku)} | ${fn(today)} |`;
  const confusion = (stats) => LEVELS.map((gold) => `| ${gold} | ${LEVELS.map((predicted) => stats.confusion[gold][predicted]).join(' | ')} |`).join('\n');
  return [
    '# Brain tag pilot: Jev against Haiku (HTPR-9044)',
    '',
    `${corpus.cases} board ${corpus.boardId} tickets with a brain label set before 2026-11-10, ${result.repeats?.length ?? 1} run(s), ${result.startedAt}.`,
    `Jev ${result.models.jev}, Haiku ${result.models.haiku} (effort medium, the Task Writer default).`,
    '',
    '| metric | Jev | Haiku | Today (always medium) |',
    '|---|---|---|---|',
    row('cases answered', (s) => `${s.answered} of ${s.cases}`),
    row('exact match', (s) => pct(s.exact)),
    row('macro exact over classes', (s) => pct(s.macroExact)),
    row('within one level', (s) => pct(s.withinOne)),
    row(`exact when confident (>= ${CONFIDENT})`, (s) => `${pct(s.confident.exact)} (${s.confident.count} cases, ${pct(s.confident.coverage)} coverage)`),
    row('latency p50 / p90', (s) => `${s.latencyMs.p50 ?? 'n/a'} / ${s.latencyMs.p90 ?? 'n/a'} ms`),
    row('cost for the whole run', (s) => (s.costUsd ? `$${s.costUsd.toFixed(4)}` : 'n/a')),
    row('errors', (s) => String(s.errors)),
    '',
    '## Confusion, Jev (rows are the label on the ticket)',
    `| ticket label | ${LEVELS.join(' | ')} |`,
    `|---|${LEVELS.map(() => '---').join('|')}|`,
    confusion(jev),
    '',
    '## Confusion, Haiku',
    `| ticket label | ${LEVELS.join(' | ')} |`,
    `|---|${LEVELS.map(() => '---').join('|')}|`,
    confusion(haiku),
    '',
    '## Every run', 
    '| run | Jev right | Haiku right | tickets | gap | 95% CI | p |',
    '|---|---|---|---|---|---|---|',
    ...(result.repeats ?? []).map((repeat, index) => `| ${index + 1} | ${repeat.jevHits} | ${repeat.haikuHits} | ${repeat.n} | ${signed(repeat.gap)} | ${signed(repeat.ci95[0])} to ${signed(repeat.ci95[1])} | ${repeat.oneSided.toFixed(2)} |`),
    '',
    '## Paired comparison on the same tickets',
    ...(result.repeats?.length ? [
      `First run: Jev right and Haiku wrong on ${result.repeats[0].jevOnly} tickets; Haiku right and Jev wrong on ${result.repeats[0].haikuOnly}; both right on ${result.repeats[0].both}; both wrong on ${result.repeats[0].neither}.`,
      `First run gap ${signed(result.repeats[0].gap)} points, 95% bootstrap CI ${signed(result.repeats[0].ci95[0])} to ${signed(result.repeats[0].ci95[1])}, one-sided exact test on the ${result.repeats[0].discordant} discordant tickets p = ${result.repeats[0].oneSided.toFixed(2)}.`,
      'A gap whose interval crosses zero is not a win, whatever the point estimate says.',
      '',
    ] : []),
    '## Verdict',
    ...result.verdict.bars.map((bar) => `- ${bar.pass ? 'PASS' : 'FAIL'} ${bar.name}: ${bar.detail}`),
    '',
    result.verdict.keep ? 'Keep Jev: it clears every bar. Next step is the shadow run on our own team only.' : 'Drop Jev for the brain tag: it does not clear every bar above.',
    '',
  ].join('\n');
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

async function runJev(cases, key, concurrency) {
  return pool(cases, concurrency, async (testCase) => {
    const started = Date.now();
    try {
      const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(jevRequest(testCase)),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(body?.error?.message ?? '').slice(0, 120)}`);
      const answer = parseJevAnswer(body);
      const { level, error, ...rest } = answer;
      return { id: testCase.id, gold: testCase.gold, latencyMs: Date.now() - started, costUsd: body?.usage?.cost ?? 0, ...rest, ...(level ? { predicted: level } : { error }) };
    } catch (error) {
      return { id: testCase.id, gold: testCase.gold, latencyMs: Date.now() - started, error: String(error?.message ?? error).slice(0, 200) };
    }
  });
}

async function runHaiku(cases, concurrency) {
  const { generateText } = require('ai');
  const { createAnthropic } = require('@ai-sdk/anthropic');
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = anthropic(HAIKU_MODEL);
  return pool(cases, concurrency, async (testCase) => {
    const started = Date.now();
    const { instructions, input } = haikuPrompts(testCase);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const reply = await generateText({ model, instructions, messages: [{ role: 'user', content: input }], maxOutputTokens: 1000, providerOptions: HAIKU_PROVIDER_OPTIONS, abortSignal: AbortSignal.timeout(30000) });
        const level = normaliseAnswer(reply.text);
        if (!level) throw new Error(`unparsed answer: ${String(reply.text).slice(0, 60)}`);
        return { id: testCase.id, gold: testCase.gold, latencyMs: Date.now() - started, predicted: level, confidence: null };
      } catch (error) {
        if (attempt === 1) return { id: testCase.id, gold: testCase.gold, latencyMs: Date.now() - started, error: String(error?.message ?? error).slice(0, 200) };
      }
    }
    return { id: testCase.id, gold: testCase.gold, error: 'unreachable' };
  });
}

function loadCorpus(file = CORPUS, limit) {
  const corpus = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stampsFile = path.join(path.dirname(file), 'timestamps.json');
  if (fs.existsSync(stampsFile)) {
    const stamps = JSON.parse(fs.readFileSync(stampsFile, 'utf8'));
    const ids = new Set(corpus.cases.map((testCase) => testCase.id));
    assert.deepEqual(Object.keys(stamps.cases).sort(), [...ids].sort(), 'Every ticket needs its label timestamps');
    const late = Object.entries(stamps.cases).filter(([, entry]) => !(entry.createdAt < stamps.cutoff && entry.updatedAt < stamps.cutoff));
    assert.deepEqual(late, [], 'A ticket was created or last touched after the label cutoff, so its brain label may be model-set');
  }
  assert.equal(corpus.boardId, 15, 'The pilot corpus must come from board 15');
  assert.ok(Array.isArray(corpus.cases) && corpus.cases.length >= 100, 'Need at least 100 labelled tickets');
  assert.equal(new Set(corpus.cases.map((testCase) => testCase.id)).size, corpus.cases.length, 'Duplicate ticket in corpus');
  for (const testCase of corpus.cases) {
    assert.ok(LEVELS.includes(testCase.gold), `${testCase.id}: gold must be a brain label`);
    assert.ok(testCase.title.trim() && testCase.text.trim(), `${testCase.id}: empty ticket text`);
  }
  assert.ok(!/\binne\b|wazig|funeral/i.test(JSON.stringify(corpus)), 'Corpus must not carry client text');
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(JSON.stringify(corpus)), 'Corpus must not carry an email address');
  return limit ? { ...corpus, cases: corpus.cases.slice(0, limit) } : corpus;
}

async function main() {
  const arg = (name, fallback) => {
    const found = process.argv.find((value) => value.startsWith(`--${name}=`));
    return found ? found.split('=')[1] : fallback;
  };
  const out = path.resolve(arg('out', path.join(process.cwd(), 'brain-tag-eval-out')));
  const replay = arg('replay');
  if (replay) {
    const saved = JSON.parse(fs.readFileSync(path.resolve(replay), 'utf8'));
    const result = assemble(saved.corpus, saved.models, saved.startedAt, saved.rows.jev, saved.rows.haiku);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'scores.json'), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(out, 'report.md'), `${renderReport(result)}\n`);
    console.log(renderReport(result));
    return;
  }
  const corpus = loadCorpus(arg('corpus', CORPUS), arg('limit') ? Number(arg('limit')) : undefined);
  const concurrency = Number(arg('concurrency', 8));
  const jevKey = process.env.OPENROUTER_EVAL_KEY;
  assert.ok(jevKey, 'Set OPENROUTER_EVAL_KEY to the capped eval key');
  assert.ok(process.env.ANTHROPIC_API_KEY, 'Set ANTHROPIC_API_KEY for the Haiku baseline');
  const repeats = Math.max(1, Number(arg('repeats', 1)));
  const startedAt = new Date().toISOString();
  const jevRuns = [];
  const haikuRuns = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    jevRuns.push(await runJev(corpus.cases, jevKey, concurrency));
    haikuRuns.push(await runHaiku(corpus.cases, concurrency));
  }
  assert.ok(haikuRuns.flat().every((row) => row.predicted), 'The Haiku baseline did not answer every ticket; rerun before deciding');
  const result = assemble({ cases: corpus.cases.length, boardId: corpus.boardId, generatedAt: corpus.generatedAt, sha256: sha(JSON.stringify(corpus.cases)) }, { jev: JEV_MODEL, haiku: HAIKU_MODEL }, startedAt, jevRuns, haikuRuns);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'scores.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'report.md'), `${renderReport(result)}\n`);
  console.log(renderReport(result));
  assert.ok(result.jev.answered > 0 && result.haiku.answered > 0, 'Both models must answer at least one ticket');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { assemble, LEVELS, CRITERIA, HAIKU_INSTRUCTIONS, JEV_MODEL, HAIKU_MODEL, normaliseAnswer, parseJevAnswer, jevRequest, haikuPrompts, scoreModel, alwaysMedium, paired, verdict, renderReport, loadCorpus, percentile };
