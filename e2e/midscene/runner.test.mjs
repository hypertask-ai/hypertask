import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import demo from './flows/task-create-demo.mjs';
import signedIn from './flows/signed-in-create-task.mjs';

// Load the step executor without launching the CLI's browser.
const source = readFileSync(new URL('./runner.mjs', import.meta.url), 'utf8');
const runStep = vm.runInNewContext(source.slice(source.indexOf('async function runStep('), source.indexOf('async function runFlow(')) + '\nrunStep', { URL });
const step = { action: 'saveTask', arg: 'Create task', value: 'QA test title' };
const fixture = { project: { id: 6859 } };

function response({ route = '/api/tasks/create', method = 'POST', title = step.value, projectId = fixture.project.id, status = 200, task = { id: 123, title } } = {}) {
  return {
    url: () => `https://app.hypertask.ai${route}`,
    request: () => ({ method: () => method, postData: () => JSON.stringify({ title, projectId }) }),
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => task,
  };
}

function pageFor(savedResponse, checkPredicate = () => {}) {
  let watching = false;
  let finish;
  return {
    waitForResponse(predicate, options) {
      watching = true;
      assert.equal(options.timeout, 30_000);
      checkPredicate(predicate);
      return new Promise((resolve) => { finish = resolve; });
    },
    locator(selector) {
      assert.equal(selector, 'button::-p-text(Create task)');
      return { click: async () => {
        assert.equal(watching, true, 'watch the save response before clicking');
        finish(savedResponse);
      } };
    },
  };
}

test('saveTask watches only the inline POST for the exact title and QA board before clicking', async () => {
  const saved = response();
  await runStep(pageFor(saved, (matches) => {
    assert.equal(matches(saved), true);
    assert.equal(matches(response({ route: '/api/tasks/createGlobally' })), false);
    assert.equal(matches(response({ route: '/api/tasks/create/other' })), false);
    assert.equal(matches(response({ method: 'GET' })), false);
    assert.equal(matches(response({ title: 'another task' })), false);
    assert.equal(matches(response({ projectId: 99 })), false);
    assert.equal(matches(response({ status: 500 })), true, 'failed saves must surface immediately');
  }), {}, step, fixture);
});

test('demo save matches the entered title without requiring a signed-in fixture', async () => {
  await runStep(pageFor(response(), (matches) => {
    assert.equal(matches(response({ projectId: 99 })), true);
    assert.equal(matches(response({ title: 'another task' })), false);
  }), {}, step);
});

test('saveTask rejects failed HTTP saves and successful responses without the matching task', async () => {
  await assert.rejects(runStep(pageFor(response({ status: 500 })), {}, step, fixture), /HTTP 500/);
  for (const task of [null, {}, { id: 123, title: 'wrong title' }]) {
    await assert.rejects(runStep(pageFor(response({ task })), {}, step, fixture), /no matching task/);
  }
});

test('both creation flows fill inline Title, save it, and verify the card after reload', () => {
  for (const flow of [demo, signedIn]) {
    const input = flow.steps.find((item) => item.action === 'input');
    const saveIndex = flow.steps.findIndex((item) => item.action === 'saveTask');
    assert.equal(input.arg, '#newTask [placeholder="Title"]');
    assert.equal(flow.steps[saveIndex].arg, 'Create task');
    assert.equal(flow.steps[saveIndex].value, input.value);
    const reloadIndex = flow.steps.findIndex((item, index) => index > saveIndex && item.action === 'goto');
    assert.ok(reloadIndex > saveIndex);
    assert.ok(flow.steps.slice(reloadIndex + 1).some((item) => item.action === 'aiAssert' && item.arg.includes(input.value)));
  }
  const shortcutIndex = signedIn.steps.findIndex((item) => item.action === 'aiKeyboardPress' && item.arg === 'c');
  assert.ok(shortcutIndex > 0);
  assert.match(signedIn.steps[shortcutIndex + 1].arg, /full new task editor.*Save & close/);
  assert.equal(signedIn.steps[shortcutIndex + 2].arg, 'Escape');
});
