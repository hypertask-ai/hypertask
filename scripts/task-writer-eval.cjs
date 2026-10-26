const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const load = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '../src') }, fsCache: false });
const { extractTaskWriterProperties } = load(path.resolve(__dirname, '../src/app/api/ai/_lib/taskWriterProperties.ts'));
const directory = path.resolve(__dirname, '../tests/fixtures/task-writer-eval');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value) => value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, n) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n]).replace(/\s+/g, ' ').trim();
const normalize = (value) => text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sectionName = (value) => {
  const name = normalize(value).replace(/^(?:\d+|[a-z])\s+/, '');
  if (/^(?:acceptance criteria|acceptance checks|success criteria|done when|done if|definition of done)$/.test(name)) return 'done when';
  if (/^variations?(?: description)?$/.test(name)) return 'variations';
  if (/^ice(?: score| scoring)?$/.test(name)) return 'ice';
  return name;
};
function sections(html) {
  return new Set([...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>|^#{1,6}\s+(.+)$/gim)].map((m) => sectionName(m[1] ?? m[2])));
}
function scoreWriter(fixture, html) {
  assert.equal(typeof html, 'string');
  const words = text(html).split(/\s+/).filter(Boolean).length;
  const found = sections(html);
  const violations = [];
  if (!words) violations.push('empty-draft');
  if (words > fixture.maxWords) violations.push('too-long');
  for (const heading of fixture.requiredSections) if (!found.has(sectionName(heading))) violations.push(`missing:${heading}`);
  for (const heading of fixture.forbiddenSections) if (found.has(sectionName(heading))) violations.push(`forbidden:${heading}`);
  if (/\b(?:TBD|TODO)\b/.test(text(html)) || /\blorem ipsum\b|\[(?:insert|copy|text|placeholder)[^\]]*\]/i.test(text(html))) violations.push('placeholder');
  return { words, violations };
}
function scoreChips(fixture, html, questions, examples) {
  assert.ok(Array.isArray(questions) && questions.every((q) => typeof q === 'string' && q.trim()), 'Malformed chip response');
  const found = sections(html);
  const violations = [];
  if (!questions.length) violations.push('empty-chips-unproven');
  for (const [index, question] of questions.entries()) {
    const normalized = normalize(question);
    if (examples.some((example) => normalize(example) === normalized)) violations.push(`${index}:prompt-example`);
    for (const heading of [...fixture.requiredSections, ...found]) {
      const name = sectionName(heading);
      const aliases = name === 'done when' ? ['done when', 'acceptance criteria', 'success criteria', 'definition of done'] : name === 'variations' ? ['variation', 'variations'] : [name];
      if (found.has(name) && /\b(add|include|insert|create|missing)\b/.test(normalized) && aliases.some((alias) => ` ${normalized} `.includes(` ${alias} `))) violations.push(`${index}:existing-section:${name}`);
    }
    for (const phrase of [...fixture.protectedPhrases, 'Proposed properties']) {
      if (/\b(remove|replace|drop|rewrite|avoid)\b/.test(normalized) && normalized.includes(normalize(phrase)) && normalize(html).includes(normalize(phrase))) violations.push(`${index}:writer-required-text`);
    }
  }
  return { count: questions.length, violations: [...new Set(violations)] };
}
function examples() {
  const { renderPrompt } = load(path.resolve(__dirname, '../src/lib/ai/prompts/registry.ts'));
  const prompt = renderPrompt('task-questions-writing-1');
  return [...prompt.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]);
}
function score(fixture, output, promptExamples) {
  return { id: fixture.id, writer: scoreWriter(fixture, output.html), chips: scoreChips(fixture, output.html, output.questions, promptExamples) };
}
function compareBaseline(results, baseline) {
  assert.deepEqual(results.map((r) => r.id), baseline.map((r) => r.id), 'Live cases differ from baseline');
  for (const kind of ['writer', 'chips']) {
    const total = (rows) => rows.reduce((n, r) => n + r[kind].violations.length, 0);
    assert.ok(total(results) <= total(baseline), `${kind} violations increased: ${total(baseline)} -> ${total(results)}`);
  }
}
function validateCorpus(corpus) {
  const real = corpus.cases.filter((c) => c.kind === 'real');
  assert.ok(real.length >= 20, 'Need at least twenty real pairs');
  assert.equal(new Set(corpus.cases.map((c) => c.id)).size, corpus.cases.length, 'Duplicate case');
  for (const fixture of corpus.cases) {
    assert.ok(fixture.notes.trim() && fixture.reference.trim() && Number.isInteger(fixture.maxWords) && fixture.maxWords > 0);
    assert.ok(Array.isArray(fixture.requiredSections) && Array.isArray(fixture.forbiddenSections) && Array.isArray(fixture.protectedPhrases));
    if (fixture.kind === 'real') {
      assert.match(fixture.id, /^(HTPR|YPER4)-\d+$/);
      assert.match(fixture.source.url, /^https:\/\/app\.hypertask\.ai\/detail\/project-(15|4060)\/\d+$/);
      assert.ok(fixture.source.descriptionVersionId > 0 && fixture.source.descriptionVersion === 1);
      assert.equal(createHash('sha256').update(fixture.notes).digest('hex'), fixture.source.notesSha256);
    } else assert.equal(fixture.kind, 'synthetic');
  }
}
function replay(corpus, recording) {
  validateCorpus(corpus);
  assert.equal(recording.mode, 'live-production');
  assert.equal(recording.accountId, 985, 'Baseline was not recorded as QA 985');
  assert.equal(recording.corpusHash, digest(corpus), 'Corpus changed: rerun live baseline');
  assert.equal(recording.outputs.length, corpus.cases.length, 'Incomplete live run');
  assert.deepEqual(recording.pendingTaskIds, [], 'Uncleaned live fixtures');
  const promptExamples = examples();
  return corpus.cases.map((fixture, index) => {
    const output = recording.outputs[index];
    assert.equal(output.id, fixture.id, 'Missing, reordered or duplicate output');
    assert.ok(output.writerStatus === 200 && output.chipStatus === 200 && output.taskId > 0 && output.cleaned === true, 'Incomplete transport or cleanup');
    return score(fixture, output, promptExamples);
  });
}
async function runLive(corpus, api, persist) {
  validateCorpus(corpus);
  const identity = await api('GET', '/api/users/getById');
  assert.equal(identity.id, 985, 'Only QA 985 may run the live eval');
  const recording = { mode: 'live-production', accountId: 985, startedAt: new Date().toISOString(), corpusHash: digest(corpus), pendingTaskIds: [], outputs: [] };
  for (const fixture of corpus.cases) {
    assert.ok(Date.now() - Date.parse(recording.startedAt) < 12 * 60 * 1000, 'Live evaluation time budget exhausted');
    let task;
    let output;
    try {
      const rawDraft = await api('POST', '/api/ai/task-writer', { projectId: 7049, PROMPT: fixture.notes, taskTitle: fixture.title, aiMode: 'AiTaskWriter', customInstructions: fixture.instructions ?? '' });
      assert.equal(typeof rawDraft, 'string', 'Writer did not return a single draft');
      assert.ok(text(rawDraft) && !rawDraft.includes('event: error') && !rawDraft.includes('"status":"error"'), 'Writer returned an empty/error stream');
      const properties = extractTaskWriterProperties(rawDraft, { fallbackTitle: fixture.title });
      const draft = properties.description;
      const created = await api('POST', '/api/tasks/createGlobally', { projectId: 7049, sectionId: 19409, section_title: 'Todo', userId: 985, title: properties.title || fixture.title, description: draft, tags: [], assignees: [], urlsToAdd: [], relationsToAdd: [] });
      task = created.newTask;
      assert.ok(Number.isSafeInteger(task?.id) && task.id > 0, 'Fixture creation returned no id');
      recording.pendingTaskIds.push(task.id);
      assert.equal(task.projectId, 7049, 'Fixture escaped QA Sandbox');
      await persist(recording);
      const saved = await api('GET', `/api/tasks/single?id=${task.id}`);
      assert.equal(saved.description_?.content, draft, 'Saved fixture differs from writer draft');
      const chips = await api('POST', '/api/ai/task-questions', { taskId: task.id, kind: 'new-ticket' });
      output = { id: fixture.id, rawHtml: rawDraft, html: draft, questions: chips.questions, taskId: task.id, writerStatus: 200, chipStatus: 200, cleaned: false };
      score(fixture, output, examples());
    } finally {
      if (output) recording.outputs.push(output);
      try {
        if (task?.id && task.projectId === 7049) {
          await api('PUT', '/api/tasks/single', { newTask: { id: task.id, status: 'Deleted' } });
          const deleted = await api('GET', `/api/tasks/single?id=${task.id}`);
          assert.equal(deleted.status, 'Deleted', 'Fixture cleanup did not persist');
          recording.pendingTaskIds = recording.pendingTaskIds.filter((id) => id !== task.id);
          if (output) output.cleaned = true;
        }
      } finally { await persist(recording); }
    }
    console.log(`completed ${fixture.id}`);
  }
  return recording;
}
async function main() {
  const corpus = JSON.parse(fs.readFileSync(path.join(directory, 'cases.json'), 'utf8'));
  if (process.argv.includes('--live')) {
    const { request } = require('playwright');
    const context = await request.newContext({ baseURL: 'https://app.hypertask.ai', ...(process.env.QA_STATE ? { storageState: process.env.QA_STATE } : {}), timeout: 30000 });
    const api = async (method, url, data) => {
      const response = await context.fetch(url, { method, ...(data === undefined ? {} : { data }), maxRedirects: 0, timeout: url === '/api/ai/task-writer' ? 120000 : 30000 });
      assert.equal(response.status(), 200, `${method} ${url}: HTTP ${response.status()}`);
      if (url === '/api/ai/task-writer') return response.text();
      return response.json();
    };
    try {
      if (!process.env.QA_STATE) {
        assert.ok(process.env.QA_LOGIN_EMAIL && process.env.QA_LOGIN_PASSWORD, 'QA renewal credentials missing');
        await api('POST', '/api/auth/qa-login', { email: process.env.QA_LOGIN_EMAIL, password: process.env.QA_LOGIN_PASSWORD });
      }
      const output = process.env.WRITER_EVAL_OUTPUT;
      assert.ok(output && !path.resolve(output).startsWith(directory + path.sep), 'Save live output outside committed fixtures; promote only after review');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const recording = await runLive(corpus, api, (recording) => {
        fs.writeFileSync(output, JSON.stringify(recording, null, 2) + '\n');
        fs.writeFileSync(output + '.status.json', JSON.stringify({ completed: recording.outputs.length, pendingTaskIds: recording.pendingTaskIds }) + '\n');
      });
      const results = replay(corpus, recording);
      fs.writeFileSync(output + '.scores.json', JSON.stringify({ corpusHash: recording.corpusHash, results }, null, 2) + '\n');
      const baselinePath = path.join(directory, 'baseline.json');
      if (fs.existsSync(baselinePath)) compareBaseline(results, JSON.parse(fs.readFileSync(baselinePath, 'utf8')).results);
      console.log('live writer/chip run complete');
    } finally { await context.dispose(); }
    return;
  }
  const recording = JSON.parse(fs.readFileSync(path.join(directory, 'recorded.json'), 'utf8'));
  const results = replay(corpus, recording);
  const baseline = { corpusHash: recording.corpusHash, results };
  if (process.argv.includes('--save-baseline')) fs.writeFileSync(path.join(directory, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n');
  assert.deepEqual(baseline, JSON.parse(fs.readFileSync(path.join(directory, 'baseline.json'), 'utf8')), 'Baseline differs: review actual score changes');
  console.log(`baseline verified: ${results.length} pairs; writer violations ${results.reduce((n, r) => n + r.writer.violations.length, 0)}; chip violations ${results.reduce((n, r) => n + r.chips.violations.length, 0)}`);
}
module.exports = { text, sections, scoreWriter, scoreChips, score, compareBaseline, validateCorpus, replay, runLive, digest };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
