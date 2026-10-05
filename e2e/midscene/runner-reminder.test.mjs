import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import flow from './flows/signed-in-reminder.mjs';

// Exercise the runner's actual step without launching its browser entry point.
const source = readFileSync(new URL('./runner.mjs', import.meta.url), 'utf8');
const runStep = vm.runInNewContext(`(${source.slice(source.indexOf('async function runStep('), source.indexOf('\nasync function runFlow('))})`, { URL });
const step = flow.steps.find((step) => step.action === 'saveReminder');
const response = (status = 200, route = '/api/queues/inboxReminder', method = 'POST') => ({
  url: () => `https://app.hypertask.ai${route}`,
  request: () => ({ method: () => method }),
  ok: () => status >= 200 && status < 300,
  status: () => status,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function mockPage(saved = Promise.resolve(response()), closed = Promise.resolve()) {
  const events = [];
  return {
    events,
    waitForResponse(predicate, options) {
      events.push('listen');
      assert.equal(options.timeout, 30_000);
      assert.equal(predicate(response()), true);
      assert.equal(predicate(response(500)), true, 'HTTP failures must be captured, not ignored');
      assert.equal(predicate(response(200, '/api/reminders/getAll', 'GET')), false);
      assert.equal(predicate(response(200, '/api/queues/inboxReminder', 'GET')), false);
      return saved;
    },
    locator(selector) {
      assert.equal(selector, '::-p-xpath(//*[@id="assignModal"]//*[@role="option"][span[normalize-space(.)="Tomorrow"]])');
      return { click: async () => { events.push('click Tomorrow'); } };
    },
    waitForSelector(selector, options) {
      events.push('wait for close');
      assert.equal(selector, '#assignModal');
      assert.equal(options.hidden, true);
      assert.equal(options.timeout, 30_000);
      return closed;
    },
  };
}

test('flow saves Tomorrow before either persistence check, without an AI option click', () => {
  assert.equal(step.arg, 'Tomorrow');
  const saveIndex = flow.steps.indexOf(step);
  const checks = flow.steps.flatMap((step, index) => step.action === 'verifyReminder' ? [index] : []);
  assert.equal(checks.length, 2);
  assert(checks.every((index) => index > saveIndex));
  assert.equal(flow.steps[saveIndex + 1].action, 'verifyReminder');
  assert.equal(flow.steps[checks[1] - 1].action, 'goto');
  assert(!flow.steps.some((step) => step.action === 'aiTap'));
});

test('registers before clicking and does not finish until save succeeds and dialog closes', async () => {
  const saved = deferred();
  const closed = deferred();
  const page = mockPage(saved.promise, closed.promise);
  let finished = false;
  const pending = runStep(page, null, step).then((result) => { finished = true; return result; });
  await new Promise(setImmediate);
  assert.deepEqual(page.events, ['listen', 'click Tomorrow']);
  assert.equal(finished, false);
  saved.resolve(response());
  await new Promise(setImmediate);
  assert.deepEqual(page.events, ['listen', 'click Tomorrow', 'wait for close']);
  assert.equal(finished, false);
  closed.resolve();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.dialogClosed, true);
});

test('failed reminder response fails immediately before persistence or dialog wait', async () => {
  const page = mockPage(Promise.resolve(response(500)));
  await assert.rejects(runStep(page, null, step), /Reminder save failed: HTTP 500/);
  assert.deepEqual(page.events, ['listen', 'click Tomorrow']);
});

test('missing response or dialog-close timeout fails the step', async () => {
  const page = mockPage();
  page.waitForResponse = async () => { throw new Error('response timeout'); };
  await assert.rejects(runStep(page, null, step), /response timeout/);
  const openDialog = mockPage();
  openDialog.waitForSelector = async () => { throw new Error('dialog close timeout'); };
  await assert.rejects(runStep(openDialog, null, step), /dialog close timeout/);
});
