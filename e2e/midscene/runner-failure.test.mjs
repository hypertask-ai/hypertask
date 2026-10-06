import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ticketPlan } from './postprocess.mjs';

const source = readFileSync(new URL('./runner.mjs', import.meta.url), 'utf8');
const flowSource = source.slice(source.indexOf('async function runFlow('), source.indexOf('async function main('));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=', 'base64');

for (const failure of ['step', 'success screenshot', 'cleanup']) {
  test(`reporter receives the failing step and real screenshot when ${failure} fails and screenshot capture is unavailable`, async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'midscene-failure-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let broken = false;
    const page = {
      setViewport: async () => {},
      screenshot: async (options) => {
        if (broken || (failure === 'success screenshot' && options?.path)) throw new Error('Screenshot unavailable');
        if (options?.path) await writeFile(options.path, png);
        return png;
      },
      close: async () => {},
    };
    const context = { newPage: async () => page, close: async () => {} };
    const runFlow = vm.runInNewContext(`${flowSource}\nrunFlow`, {
      Date, path, mkdir, writeFile, SCREENSHOT_DIR: dir,
      console: { log: () => {}, warn: () => {} }, process: { argv: [] },
      PuppeteerAgent: class {},
      prepareQa: async () => ({ values: {} }), observeFixtures: () => () => {},
      resolveStep: (step) => step,
      runStep: async () => {
        if (failure === 'step') { broken = true; throw new Error('Assertion failed'); }
      },
      cleanupQaAfterFlow: async () => { if (failure === 'cleanup') throw new Error('Cleanup failed'); },
    });
    const result = await runFlow({ createBrowserContext: async () => context }, {
      id: 'signed-in-create-task', signedIn: true, steps: [{ action: 'aiAssert', arg: 'new card visible' }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.failedStep, failure === 'step' ? '1. aiAssert: new card visible'
      : failure === 'cleanup' ? 'QA fixture cleanup' : 'Capture completed flow screenshot');
    assert.ok(path.isAbsolute(result.screenshotPath));
    assert.deepEqual(readFileSync(result.screenshotPath), png);
    if (failure !== 'cleanup') assert.match(result.error, /last available pre-step viewport/);
    const plan = ticketPlan(result);
    assert.equal(plan.screenshotPath, result.screenshotPath);
    assert.ok(plan.description.includes(result.failedStep));
  });
}
