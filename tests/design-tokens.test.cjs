const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');

async function lint(code, baseline = {}, filename = 'src/components/DesignTokenFixture.tsx') {
  const { ESLint } = await import('eslint');
  const parser = (await import('@typescript-eslint/parser')).default;
  const { designTokenRules } = await import('../eslint-local-rules/design-tokens.mjs');
  const rules = designTokenRules(baseline);
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.{ts,tsx}'],
      languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { local: { rules } },
      rules: Object.fromEntries(Object.keys(rules).map(rule => [`local/${rule}`, 'error'])),
    }],
  });
  const [result] = await eslint.lintText(code, { filePath: resolve(filename) });
  return result.messages;
}

test('raw utility families fail while named and variable tokens pass', async () => {
  const messages = await lint('const x = <div className="hover:shadow-[0_2px_4px_black] z-[999] rounded-t-[5px] text-[13px] bg-[#123456] [.amoled_&]:border-white" />;');
  assert.deepEqual(messages.map(m => m.ruleId).sort(), [
    'colours', 'corners', 'layers', 'shadows', 'text-sizes', 'theme-selectors',
  ].map(f => `local/no-raw-design-${f}`).sort());
  assert.deepEqual(await lint('const x = <div className="shadow-card z-modal rounded-sm text-sm bg-background hover:shadow-[var(--elevation-card)] z-[var(--layer-modal)] rounded-[var(--corner-card)] text-[var(--font-body)] bg-[var(--background)]" />;'), []);
});

test('raw styles in shared strings, variants and templates cannot bypass the guard', async () => {
  const messages = await lint('const classes = `focus:!shadow-[0_0_2px_black] ${active ? "!-z-[12]" : "rounded-[6px]"}`;');
  assert.deepEqual(messages.map(m => m.ruleId).sort(), ['corners', 'layers', 'shadows'].map(f => `local/no-raw-design-${f}`).sort());
});

test('inline shadows and raw component style colours fail, variables remain allowed', async () => {
  const messages = await lint('const style = { boxShadow: "0 1px 2px black", backgroundColor: "#fff", color: "rgb(1, 2, 3)" };');
  assert.equal(messages.filter(m => m.ruleId === 'local/no-raw-design-shadows').length, 1);
  assert.equal(messages.filter(m => m.ruleId === 'local/no-raw-design-colours').length, 2);
  assert.deepEqual(await lint('const style = { boxShadow: "var(--elevation-card)", color: "var(--text)", backgroundColor: "transparent" };'), []);
});

test('actual theme definitions own raw values, ordinary source files do not', async () => {
  assert.deepEqual(await lint('const style = { boxShadow: "0 1px 2px #000", color: "#fff" };', {}, 'src/styles/tailwindThemes/fixture.ts'), []);
  assert.equal((await lint('const style = { color: "#fff" };', {}, 'src/components/fixture.ts')).length, 1);
});

test('existing debt passes, additional debt and new files fail, reduced debt requires pruning', async () => {
  const baseline = { shadows: { 'src/components/DesignTokenFixture.tsx': 1 } };
  const raw = 'const x = "shadow-[0_1px_2px_black]";';
  assert.deepEqual(await lint(raw, baseline), []);
  assert.equal((await lint(raw + 'const y = "shadow-[0_0_2px_black]";', baseline)).length, 1);
  assert.equal((await lint(raw, baseline, 'src/components/New.tsx')).filter(m => m.messageId === 'raw').length, 1);
  const reduced = await lint('const x = "shadow-card";', baseline);
  assert.equal(reduced.length, 1);
  assert.equal(reduced[0].messageId, 'stale');
});

test('pruning deletes removed debt but refuses any increased or moved allowance', async () => {
  const { pruneBaseline } = await import('../scripts/design-token-baseline.mjs');
  const baseline = { shadows: { 'src/old.tsx': 2, 'src/removed.tsx': 1 } };
  assert.deepEqual(pruneBaseline(baseline, { shadows: { 'src/old.tsx': 1 } }), { shadows: { 'src/old.tsx': 1 } });
  assert.throws(() => pruneBaseline(baseline, { shadows: { 'src/old.tsx': 3 } }), /increased/);
  assert.throws(() => pruneBaseline(baseline, { shadows: { 'src/new.tsx': 1 } }), /increased/);
});

test('normal repository ESLint enables every family alongside no-comments', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile('src/components/DesignTokenFixture.tsx');
  for (const family of ['shadows', 'layers', 'corners', 'text-sizes', 'colours', 'theme-selectors']) {
    assert.equal(config.rules[`local/no-raw-design-${family}`][0], 2);
  }
  assert.equal(config.rules['local/no-comments'][0], 2);
  const [raw] = await eslint.lintText('export const x = <div className="shadow-[0_1px_2px_black]" />;', { filePath: 'src/components/DesignTokenFixture.tsx' });
  assert.ok(raw.messages.some(m => m.ruleId === 'local/no-raw-design-shadows'));
  const [token] = await eslint.lintText('export const x = <div className="shadow-[var(--elevation-card)]" />;', { filePath: 'src/components/DesignTokenFixture.tsx' });
  assert.equal(token.errorCount, 0, JSON.stringify(token.messages));
});

test('mixing a token into a raw value does not hide debt', async () => {
  const messages = await lint('const x = "shadow-[0_0_#fff_var(--shadow)] bg-[var(--background,#fff)]";');
  assert.ok(messages.some(m => m.ruleId === 'local/no-raw-design-shadows'));
});

test('inventory counts real files and ignores inline disable directives', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { countDesignTokens } = await import('../scripts/design-token-baseline.mjs');
  const cwd = mkdtempSync(resolve(tmpdir(), 'design-token-count-'));
  try {
    mkdirSync(resolve(cwd, 'src'));
    writeFileSync(resolve(cwd, 'src/Test.tsx'), '/* eslint-disable local/no-raw-design-shadows */\nconst x = <div className="shadow-[0_0_2px_black] rounded-[5px]" />;');
    writeFileSync(resolve(cwd, 'src/tokens.generated.ts'), 'const x = { color: "#fff" };');
    const counts = await countDesignTokens(cwd);
    assert.equal(counts.shadows['src/Test.tsx'], 1);
    assert.equal(counts.corners['src/Test.tsx'], 1);
    assert.deepEqual(counts.layers, {});
    assert.deepEqual(counts.colours, {});
    writeFileSync(resolve(cwd, 'src/Test.tsx'), 'const = ;');
    await assert.rejects(countDesignTokens(cwd), /Parsing error/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('CLI cache cannot preserve a pass after the baseline shrinks', () => {
  const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, unlinkSync } = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const root = resolve(__dirname, '..');
  const cwd = mkdtempSync(resolve(root, '.design-token-test-'));
  try {
    mkdirSync(resolve(cwd, 'eslint-local-rules'));
    mkdirSync(resolve(cwd, 'src'));
    for (const file of ['no-comments.mjs', 'design-tokens.mjs']) {
      copyFileSync(resolve(root, 'eslint-local-rules', file), resolve(cwd, 'eslint-local-rules', file));
    }
    const baselinePath = resolve(cwd, 'eslint-local-rules/design-tokens-baseline.json');
    writeFileSync(baselinePath, JSON.stringify({ shadows: { 'src/Test.tsx': 1 } }));
    writeFileSync(resolve(cwd, 'eslint.config.mjs'), 'import config from "./eslint-local-rules/no-comments.mjs"; export default [config];');
    writeFileSync(resolve(cwd, 'src/Test.tsx'), 'const x = "shadow-[0_0_2px_black]";');
    const run = () => spawnSync(process.execPath, [resolve(root, 'node_modules/eslint/bin/eslint.js'), '--cache', '--cache-strategy', 'content', 'src'], { cwd, encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.equal(run().status, 0);
    writeFileSync(resolve(cwd, 'src/Keep.tsx'), 'const keep = "shadow-card";');
    unlinkSync(resolve(cwd, 'src/Test.tsx'));
    const deleted = run();
    assert.equal(deleted.status, 1, deleted.stdout + deleted.stderr);
    assert.match(deleted.stdout, /Deleted files retain design-token debt/);
    writeFileSync(baselinePath, '{}');
    assert.equal(run().status, 0);
    writeFileSync(resolve(cwd, 'src/Test.tsx'), 'const x = "shadow-[0_0_2px_black]";');
    const raw = run();
    assert.equal(raw.status, 1, raw.stdout + raw.stderr);
    assert.match(raw.stdout, /local\/no-raw-design-shadows/);
    writeFileSync(resolve(cwd, 'src/Test.tsx'), 'const x = "shadow-card";');
    const token = run();
    assert.equal(token.status, 0, token.stdout + token.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('raw inline geometry and shadow suffixes fail, conditional token styles pass', async () => {
  const messages = await lint('const style = { zIndex: 999, borderTopLeftRadius: "5px", fontSize: 13, boxShadow: "var(--elevation-card),0 0 4px black" };');
  assert.deepEqual(messages.map(m => m.ruleId).sort(), ['layers', 'corners', 'text-sizes', 'shadows'].map(f => `local/no-raw-design-${f}`).sort());
  assert.deepEqual(await lint('const style = { boxShadow: active ? "var(--elevation-card)" : undefined, zIndex: "var(--layer-modal)", borderRadius: "var(--corner-card)", fontSize: "var(--font-body)" };'), []);
  const fallback = await lint('const x = "bg-[var(--background,#fff)]";');
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].ruleId, 'local/no-raw-design-colours');
});
