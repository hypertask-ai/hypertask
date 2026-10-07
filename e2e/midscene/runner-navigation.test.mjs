import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import boardDemo from './flows/board-demo.mjs';

const source = readFileSync(new URL('./runner.mjs', import.meta.url), 'utf8');
const stepSource = source.slice(source.indexOf('const DNS_OR_CONNECTION_ERROR'), source.indexOf('async function runFlow('));
const runStep = vm.runInNewContext(`${stepSource}\nrunStep`, { console: { warn: () => {} } });
const navigation = boardDemo.steps[0];

function mockPage(errors) {
  const calls = [];
  return {
    calls,
    goto: async (url, options) => {
      calls.push({ url, options });
      const error = errors.shift();
      if (error) throw error;
    },
  };
}

test('board demo retries one network change at the same URL with the same navigation options', async () => {
  const page = mockPage([new Error(`net::ERR_NETWORK_CHANGED at ${navigation.arg}`)]);
  const result = await runStep(page, null, navigation);
  assert.equal(result.resolvedUrl, navigation.arg);
  assert.equal(page.calls.length, 2);
  for (const call of page.calls) {
    assert.equal(call.url, navigation.arg);
    assert.equal(call.options.waitUntil, 'networkidle2');
    assert.equal(call.options.timeout, 60_000);
  }
});

test('board demo succeeds without retry when navigation succeeds immediately', async () => {
  const page = mockPage([]);
  await runStep(page, null, navigation);
  assert.equal(page.calls.length, 1);
});

test('persistent network changes fail after exactly one retry without using a fallback', async () => {
  const first = new Error('net::ERR_NETWORK_CHANGED');
  const second = new Error('net::ERR_NETWORK_CHANGED on retry');
  const page = mockPage([first, second]);
  await assert.rejects(runStep(page, null, { ...navigation, fallback: 'https://example.com' }), (error) => error === second);
  assert.equal(page.calls.length, 2);
  assert.ok(page.calls.every((call) => call.url === navigation.arg));
});

test('flows without explicit opt-in still fail immediately on network changes', async () => {
  const error = new Error('net::ERR_NETWORK_CHANGED');
  const page = mockPage([error]);
  await assert.rejects(runStep(page, null, { action: 'goto', arg: navigation.arg }), (failure) => failure === error);
  assert.equal(page.calls.length, 1);
});

for (const message of ['Navigation timeout of 60000 ms exceeded', 'net::ERR_CONNECTION_RESET', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_CONNECTION_REFUSED']) {
  test(`board demo does not retry ${message}`, async () => {
    const error = new Error(message);
    const page = mockPage([error]);
    await assert.rejects(runStep(page, null, navigation), (failure) => failure === error);
    assert.equal(page.calls.length, 1);
  });
}

for (const message of ['net::ERR_NAME_NOT_RESOLVED', 'net::ERR_CONNECTION_REFUSED']) {
  test(`existing explicit fallback still handles ${message}`, async () => {
    const page = mockPage([new Error(message)]);
    const fallback = 'https://example.com';
    const result = await runStep(page, null, { ...navigation, fallback });
    assert.equal(result.resolvedUrl, fallback);
    assert.equal(page.calls.length, 2);
    assert.equal(page.calls[1].url, fallback);
  });
}

test('a non-network failure after a network change is not retried or hidden by fallback', async () => {
  const error = new Error('Navigation timeout of 60000 ms exceeded');
  const page = mockPage([new Error('net::ERR_NETWORK_CHANGED'), error]);
  await assert.rejects(runStep(page, null, { ...navigation, fallback: 'https://example.com' }), (failure) => failure === error);
  assert.equal(page.calls.length, 2);
});
