const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs');
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
    for (const [imports, expected] of [
      ["import { mode } from '@/models/enums'; import type { Contract } from '../HTCTypes'; export const a: Contract = String(mode);", 0],
      ["import { commands } from '../commands'; export { commands };", 1],
      ["import { other } from './other'; export { other };", 1],
      ["import { flags } from '@/lib/flags'; export { flags };", 1],
    ]) {
      put(board, imports);
      const result = spawnSync(process.execPath, [cli, '--config', config, '--ts-config', 'tsconfig.json', board], { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, expected, result.stderr + result.stdout);
    }
    put(board, "import { mode } from '@/models/enums'; export { mode };");
    put('src/components/Modals/commands/HTC/commands.ts', "import { mode } from './domains/boardCommands'; export { mode };");
    const assembly = spawnSync(process.execPath, [cli, '--config', config, '--ts-config', 'tsconfig.json', 'src/components/Modals/commands/HTC/commands.ts'], { cwd: dir, encoding: 'utf8' });
    assert.equal(assembly.status, 0, assembly.stderr + assembly.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
