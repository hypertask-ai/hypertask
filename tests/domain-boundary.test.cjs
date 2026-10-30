const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const config = path.join(root, '.dependency-cruiser.cjs');

test('board registration boundary accepts contracts and rejects concrete domains', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'domain-boundary-'));
  try {
    const put = (file, content) => {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    };
    put('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
    put('src/models/enums.ts', 'export const mode = 1;');
    put('src/components/Modals/commands/HTC/HTCTypes.ts', 'export type Contract = string;');
    put('src/components/Modals/commands/HTC/commands.ts', 'export const commands = 1;');
    put('src/lib/flags.ts', 'export const flags = 1;');
    put('src/components/Modals/commands/HTC/domains/other.ts', 'export const other = 1;');
    const board = 'src/components/Modals/commands/HTC/domains/boardCommands.ts';
    const cases = [
      ["import { mode } from '@/models/enums'; import type { Contract } from '../HTCTypes'; export const a: Contract = String(mode);", ['src/models/enums.ts', 'src/components/Modals/commands/HTC/HTCTypes.ts'], false],
      ["import { commands } from '../commands'; export { commands };", ['src/components/Modals/commands/HTC/commands.ts'], true],
      ["import { other } from './other'; export { other };", ['src/components/Modals/commands/HTC/domains/other.ts'], true],
      ["import { flags } from '@/lib/flags'; export { flags };", ['src/lib/flags.ts'], true],
      ["import type { flags } from '@/lib/flags'; export type Flag = typeof flags;", ['src/lib/flags.ts'], true],
    ];
    for (const [imports, targets, forbidden] of cases) {
      put(board, imports);
      const args = [cli, '--config', config, '--ts-config', 'tsconfig.json'];
      const result = spawnSync(process.execPath, [...args, board], { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, forbidden ? 1 : 0, result.stderr + result.stdout);
      const json = spawnSync(process.execPath, [...args, '--output-type', 'json', board], { cwd: dir, encoding: 'utf8' });
      assert.equal(json.status, 0, json.stderr);
      const report = JSON.parse(json.stdout);
      const scannedModule = report.modules.find((item) => item.source === board);
      assert.ok(scannedModule, `Missing scanned module: ${board}`);
      for (const target of targets) {
        assert.ok(report.modules.some((item) => item.source === target), `Missing module: ${target}`);
        assert.ok(scannedModule.dependencies.some((item) => item.resolved === target), `Missing dependency: ${target}`);
      }
      assert.deepEqual(report.summary.violations.map(({ from, to, rule }) => ({ from, to, name: rule.name, severity: rule.severity })), forbidden
        ? [{ from: board, to: targets[0], name: 'board-registration-boundary', severity: 'error' }]
        : []);
    }
    put(board, "import { mode } from '@/models/enums'; export { mode };");
    put('src/components/Modals/commands/HTC/commands.ts', "import { mode } from './domains/boardCommands'; export { mode };");
    const assembly = spawnSync(process.execPath, [cli, '--config', config, '--ts-config', 'tsconfig.json', '--output-type', 'json', 'src/components/Modals/commands/HTC/commands.ts'], { cwd: dir, encoding: 'utf8' });
    assert.equal(assembly.status, 0, assembly.stderr + assembly.stdout);
    const report = JSON.parse(assembly.stdout);
    const scannedModule = report.modules.find((item) => item.source === 'src/components/Modals/commands/HTC/commands.ts');
    assert.ok(scannedModule?.dependencies.some((item) => item.resolved === board));
    assert.ok(report.modules.some((item) => item.source === board));
    assert.deepEqual(report.summary.violations, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
