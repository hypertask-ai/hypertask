const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const load = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false });
const { PROMPTS, renderPrompt, identifyPrompt } = load(path.join(root, 'src/lib/ai/prompts/registry.ts'));
const baseline = require('./fixtures/ai/prompt-baseline.json');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function longPromptLiterals(text, filename) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const parts = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)] : [node.text];
      if (parts.join('').length > 200) found.push(node.getStart(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('all extracted prompt parts and interpolation expressions preserve original bytes', () => {
  assert.equal(Object.keys(PROMPTS).length, baseline.length);
  for (const entry of baseline) {
    const prompt = PROMPTS[entry.id];
    assert.equal(prompt.id, entry.id);
    assert.equal(prompt.version, entry.version);
    assert.equal(hash(prompt.parts), entry.partsHash, `${entry.id} text changed`);
    const filename = path.join(root, entry.file);
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    let expressions;
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'renderPrompt' && node.arguments[0]?.text === entry.id) {
        expressions = node.arguments.slice(1).map((argument) => (ts.isParenthesizedExpression(argument) ? argument.expression : argument).getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(hash(expressions), entry.expressionsHash, `${entry.id} interpolation changed`);
    const values = prompt.parts.slice(1).map((_, index) => `fixture-${index}`);
    assert.equal(renderPrompt(entry.id, ...values), prompt.parts.map((part, index) => (index ? values[index - 1] : '') + part).join(''));
  }
});

test('route prompt literals are short and the detector rejects a known long inline prompt', () => {
  assert.equal(longPromptLiterals(`const system = ${JSON.stringify('a'.repeat(201))}`, 'positive.ts').length, 1);
  const routes = fs.readdirSync(path.join(root, 'src/app/api/ai'), { recursive: true }).filter((file) => file.endsWith('route.ts'));
  for (const file of routes) {
    const filename = path.join(root, 'src/app/api/ai', file);
    assert.deepEqual(longPromptLiterals(fs.readFileSync(filename, 'utf8'), filename), [], file);
  }
});

test('prompt identification records only id and version, including composed chat prompts', () => {
  const { AGENT_SYSTEM_PROMPT } = load(path.join(root, 'src/lib/ai/chatStream/prompt.ts'));
  assert.deepEqual(identifyPrompt([{ role: 'system', content: `${AGENT_SYSTEM_PROMPT}\nUser-specific context` }]), { promptId: 'agent-system-prompt', promptVersion: '1' });
  assert.deepEqual(identifyPrompt([{ role: 'user', content: [{ type: 'text', text: renderPrompt('task-summaries-system-2') }] }]), { promptId: 'task-summaries-system-2', promptVersion: '1' });
  assert.deepEqual(identifyPrompt([{ role: 'user', content: 'private dynamic content' }]), { promptId: 'dynamic-input', promptVersion: '1' });
  const { createPromptForTiptapForwardSlash } = load(path.join(root, 'src/app/api/ai/_lib/editorAiPrompts.ts'));
  const composed = createPromptForTiptapForwardSlash('WriteContent', '', 'fixture request');
  assert.ok(identifyPrompt([{ role: 'system', content: composed }]).promptId.startsWith('editor-ai-prompts-'));
  assert.throws(() => renderPrompt('agent-system-prompt'), /interpolation count/);
});
