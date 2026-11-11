#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { LEVELS, HAIKU_INSTRUCTIONS, loadCorpus, normaliseAnswer, scoreModel, alwaysMedium, paired } = require('./brain-tag-eval.cjs');

const CORPUS = path.resolve(__dirname, '../tests/fixtures/brain-tag-eval/corpus.json');
const JEV_MODEL = 'typesafe/jev-router';
const GROK_MODEL = 'x-ai/grok-4.7';
const GROK_PRICING = { prompt: 0.000002, completion: 0.000006 };
const CONFIDENT = 0.7;
const KEEP_MARGIN = 0.05;
const DEFAULT_BUDGET_USD = 2;
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const sha = (value) => createHash('sha256').update(value).digest('hex');

function buildSample(cases, size) {
  const sorted = [...cases].sort((a, b) => (a.id < b.id ? -1 : 1));
  const pools = new Map(LEVELS.map((level) => [level, sorted.filter((testCase) => testCase.gold === level)]));
  const total = sorted.length;
  const exact = LEVELS.map((level) => ({ level, share: (pools.get(level).length / total) * size }));
  const counts = new Map(exact.map((entry) => [entry.level, Math.max(1, Math.floor(entry.share))]));
  let assigned = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const order = [...exact].sort((a, b) => (b.share - Math.floor(b.share)) - (a.share - Math.floor(a.share)));
  while (assigned < size) {
    for (const entry of order) {
      if (assigned >= size) break;
      if (counts.get(entry.level) >= pools.get(entry.level).length) continue;
      counts.set(entry.level, counts.get(entry.level) + 1);
      assigned += 1;
    }
  }
  while (assigned > size) {
    const biggest = [...counts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1])[0];
    if (!biggest) break;
    counts.set(biggest[0], biggest[1] - 1);
    assigned -= 1;
  }
  const picked = [];
  for (const level of LEVELS) {
    const pool = pools.get(level);
    const count = Math.min(counts.get(level), pool.length);
    const stride = pool.length / count;
    for (let index = 0; index < count; index++) picked.push(pool[Math.min(pool.length - 1, Math.round(index * stride))]);
  }
  return picked.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function chatRequest(model, testCase) {
  return {
    model,
    messages: [
      { role: 'system', content: HAIKU_INSTRUCTIONS },
      { role: 'user', content: `TICKET\nTitle: ${testCase.title}\n\n${testCase.text}\n\nAnswer with one word.` },
    ],
    max_tokens: 2000,
    usage: { include: true },
  };
}

function grokCost(usage) {
  if (typeof usage?.cost === 'number') return usage.cost;
  const prompt = Number(usage?.prompt_tokens ?? 0);
  const completion = Number(usage?.completion_tokens ?? 0);
  return prompt * GROK_PRICING.prompt + completion * GROK_PRICING.completion;
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

function budgeted(budget) {
  let spent = 0;
  return {
    left: () => spent < budget,
    add: (cost) => { spent += Number.isFinite(cost) ? cost : 0; return spent; },
    spent: () => spent,
  };
}

async function callJson(url, body, key, timeoutMs) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(payload?.error?.message ?? text).slice(0, 140)}`);
  if (!payload) throw new Error(`not json: ${text.slice(0, 120)}`);
  return payload;
}

async function runModel(cases, model, key, { concurrency, meter, timeoutMs = 60000 }) {
  return pool(cases, concurrency, async (testCase) => {
    if (!meter.left()) return { id: testCase.id, gold: testCase.gold, error: 'budget reached' };
    const started = Date.now();
    const cost = (usage) => (model === GROK_MODEL ? grokCost(usage) : Number(usage?.cost ?? 0));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = await callJson(CHAT_URL, chatRequest(model, testCase), key, timeoutMs);
        const content = body?.choices?.[0]?.message?.content;
        const level = normaliseAnswer(content);
        if (!level) throw new Error(`unparsed answer: ${String(content).slice(0, 60)}`);
        const costUsd = cost(body?.usage);
        meter.add(costUsd);
        return { id: testCase.id, gold: testCase.gold, latencyMs: Date.now() - started, costUsd, predicted: level, confidence: null };
      } catch (error) {
        if (attempt === 1) return { id: testCase.id, gold: testCase.gold, latencyMs: Date.now() - started, error: String(error?.message ?? error).slice(0, 200) };
      }
    }
    return { id: testCase.id, gold: testCase.gold, error: 'unreachable' };
  });
}

const pct = (value) => (value === null || value === undefined ? 'n/a' : `${Math.round(value * 100)}%`);
const signed = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}`;
const money = (value) => `$${Number(value ?? 0).toFixed(4)}`;
const perTagCost = (stats) => (stats.costUsd && stats.answered ? `$${(stats.costUsd / stats.answered).toFixed(5)}` : 'n/a');

function decide(jev, grok, today, pairs) {
  const gap = pairs ? pairs.gap : null;
  const bars = [
    { name: 'jev router beats grok by 5 points of exact match, and the interval clears zero', pass: gap !== null && gap >= KEEP_MARGIN - 1e-9 && pairs.ci95[0] > 0, detail: gap === null ? 'no pairs' : `gap ${signed(gap)} points, 95% CI ${signed(pairs.ci95[0])} to ${signed(pairs.ci95[1])}` },
    { name: 'jev router is not slower than grok', pass: jev.latencyMs.p50 !== null && grok.latencyMs.p50 !== null && jev.latencyMs.p50 <= grok.latencyMs.p50, detail: `p50 ${jev.latencyMs.p50}ms vs ${grok.latencyMs.p50}ms` },
    { name: 'jev router costs less per tag', pass: jev.costUsd > 0 && grok.costUsd > 0 && jev.costUsd < grok.costUsd, detail: `${money(jev.costUsd)} vs ${money(grok.costUsd)}` },
    { name: 'jev router beats the always medium default', pass: jev.exact !== null && today.exact !== null && jev.exact - today.exact >= KEEP_MARGIN, detail: `${pct(jev.exact)} vs ${pct(today.exact)}` },
    { name: 'jev router answers nearly every ticket', pass: jev.cases > 0 && jev.errors / jev.cases <= 0.02, detail: `${jev.errors} of ${jev.cases} failed` },
    { name: 'grok answers nearly every ticket', pass: grok.cases > 0 && grok.errors / grok.cases <= 0.02, detail: `${grok.errors} of ${grok.cases} failed` },
  ];
  const confidentBetter = jev.confident.exact !== null && grok.exact !== null && jev.confident.exact > grok.exact + KEEP_MARGIN && jev.confident.count >= 5;
  const recommendation = bars.every((bar) => bar.pass) ? 'switch' : confidentBetter ? 'split' : 'keep';
  return { recommendation, bars, confidentBetter };
}

function renderReport(result) {
  const { jev, grok, today, corpus, pairs, decision } = result;
  const row = (name, fn) => `| ${name} | ${fn(jev)} | ${fn(grok)} | ${fn(today)} |`;
  const confusion = (stats) => LEVELS.map((gold) => `| ${gold} | ${LEVELS.map((predicted) => stats.confusion[gold][predicted]).join(' | ')} |`).join('\n');
  return [
    '# Brain tag pilot: Jev Router against Grok (HYCI-246)',
    '',
    `${corpus.cases} board ${corpus.boardId} tickets, sampled from the frozen corpus set before 2026-11-10, ${result.startedAt}.`,
    `Jev ${result.models.jev} and Grok ${result.models.grok}, both through OpenRouter chat completions with the same four level definitions and the same one word answer.`,
    '',
    '| metric | Jev Router | Grok | Today (always medium) |',
    '|---|---|---|---|',
    row('cases answered', (s) => `${s.answered} of ${s.cases}`),
    row('exact match', (s) => pct(s.exact)),
    row('macro exact over classes', (s) => pct(s.macroExact)),
    row('within one level', (s) => pct(s.withinOne)),
    row(`exact when confident (>= ${CONFIDENT})`, (s) => `${pct(s.confident.exact)} (${s.confident.count} cases, ${pct(s.confident.coverage)} coverage)`),
    row('latency p50 / p90', (s) => `${s.latencyMs.p50 ?? 'n/a'} / ${s.latencyMs.p90 ?? 'n/a'} ms`),
    row('cost for the whole run', (s) => money(s.costUsd)),
    row('cost per tag', (s) => perTagCost(s)),
    row('errors', (s) => String(s.errors)),
    '',
    '## Exact match per class',
    `| ticket label | n | Jev Router | Grok |`,
    '|---|---|---|---|',
    ...jev.perClass.map((entry) => {
      const other = grok.perClass.find((rowEntry) => rowEntry.gold === entry.gold);
      return `| ${entry.gold} | ${entry.n} | ${pct(entry.exact)} | ${pct(other?.exact ?? null)} |`;
    }),
    '',
    '## Confusion, Jev Router (rows are the label on the ticket)',
    `| ticket label | ${LEVELS.join(' | ')} |`,
    `|---|${LEVELS.map(() => '---').join('|')}|`,
    confusion(jev),
    '',
    '## Confusion, Grok',
    `| ticket label | ${LEVELS.join(' | ')} |`,
    `|---|${LEVELS.map(() => '---').join('|')}|`,
    confusion(grok),
    '',
    '## Paired comparison on the same tickets',
    pairs ? `Jev right and Grok wrong on ${pairs.jevOnly}; Grok right and Jev wrong on ${pairs.haikuOnly}; both right on ${pairs.both}; both wrong on ${pairs.neither}. Gap ${signed(pairs.gap)} points, 95% bootstrap CI ${signed(pairs.ci95[0])} to ${signed(pairs.ci95[1])}.` : 'No pairs to compare.',
    '',
    '## Verdict',
    ...decision.bars.map((bar) => `- ${bar.pass ? 'PASS' : 'FAIL'} ${bar.name}: ${bar.detail}`),
    '',
    `Recommendation: ${decision.recommendation}`,
    '',
  ].join('\n');
}

function assemble({ cases, boardId, generatedAt, sha256 }, models, startedAt, jevRows, grokRows, budget) {
  const jev = scoreModel(jevRows);
  const grok = scoreModel(grokRows);
  const today = alwaysMedium(grokRows);
  const pairs = paired(jevRows, grokRows);
  const decision = decide(jev, grok, today, pairs);
  return {
    startedAt,
    budgetUsd: budget,
    corpus: { cases: cases.length, boardId, generatedAt, sha256 },
    models,
    jev,
    grok,
    today,
    pairs,
    decision,
    spendUsd: jev.costUsd + grok.costUsd,
    rows: { jev: jevRows, grok: grokRows },
  };
}

async function main() {
  const arg = (name, fallback) => {
    const found = process.argv.find((value) => value.startsWith(`--${name}=`));
    return found ? found.split('=')[1] : fallback;
  };
  const out = path.resolve(arg('out', path.join(process.cwd(), 'brain-tag-grok-eval-out')));
  const corpus = loadCorpus(arg('corpus', CORPUS));
  const size = Number(arg('cases', 40));
  const concurrency = Number(arg('concurrency', 6));
  const budget = Number(arg('budget-usd', DEFAULT_BUDGET_USD));
  const key = process.env.OPENROUTER_EVAL_KEY;
  if (!key) throw new Error('Set OPENROUTER_EVAL_KEY to a capped OpenRouter key');
  const cases = buildSample(corpus.cases, size);
  const startedAt = new Date().toISOString();
  const jevMeter = budgeted(budget);
  const jevRows = await runModel(cases, JEV_MODEL, key, { concurrency, meter: jevMeter });
  const grokRows = await runModel(cases, GROK_MODEL, key, { concurrency, meter: budgeted(budget - jevMeter.spent()) });
  const result = assemble({ cases, boardId: corpus.boardId, generatedAt: corpus.generatedAt, sha256: sha(JSON.stringify(corpus.cases)) }, { jev: JEV_MODEL, grok: GROK_MODEL }, startedAt, jevRows, grokRows, budget);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'scores.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'report.md'), `${renderReport(result)}\n`);
  console.log(renderReport(result));
  if (result.spendUsd > budget) throw new Error(`Spent ${money(result.spendUsd)}, over the ${money(budget)} budget`);
  if (!result.jev.answered || !result.grok.answered) throw new Error('Both models must answer at least one ticket');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { buildSample, chatRequest, grokCost, decide, renderReport, assemble, runModel, budgeted, JEV_MODEL, GROK_MODEL, DEFAULT_BUDGET_USD };
