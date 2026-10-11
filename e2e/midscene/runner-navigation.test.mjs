import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import boardDemo from './flows/board-demo.mjs';

const source = readFileSync(new URL('./runner.mjs', import.meta.url), 'utf8');
const stepSource = source.slice(source.indexOf('const DNS_OR_CONNECTION_ERROR'), source.indexOf('async function runFlow('));
const warnings = [];
const runStep = vm.runInNewContext(`${stepSource}\nrunStep`, { console: { warn: (line) => warnings.push(line) }, setTimeout });
// YPER4-266: every goto retries transient network errors; tests skip the 2s wait.
const navigation = { ...boardDemo.steps[0], retryDelayMs: 0 };

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

test('a goto that hits ERR_NETWORK_CHANGED once is retried at the same URL and options, and passes', async () => {
  warnings.length = 0;
  const page = mockPage([new Error(`net::ERR_NETWORK_CHANGED at ${navigation.arg}`)]);
  const result = await runStep(page, null, navigation);
  assert.equal(result.resolvedUrl, navigation.arg);
  assert.equal(page.calls.length, 2);
  for (const call of page.calls) {
    assert.equal(call.url, navigation.arg);
    assert.equal(call.options.waitUntil, 'networkidle2');
    assert.equal(call.options.timeout, 60_000);
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /retry 1 of 2/);
});

test('a goto that succeeds immediately is not retried', async () => {
  const page = mockPage([]);
  await runStep(page, null, navigation);
  assert.equal(page.calls.length, 1);
});

test('two network blips in a row still pass on the third try', async () => {
  const page = mockPage([new Error('net::ERR_NETWORK_CHANGED'), new Error('net::ERR_CONNECTION_RESET')]);
  await runStep(page, null, navigation);
  assert.equal(page.calls.length, 3);
});

test('three network failures fail with the last error after exactly two retries', async () => {
  const last = new Error('net::ERR_NETWORK_CHANGED third');
  const page = mockPage([new Error('net::ERR_NETWORK_CHANGED'), new Error('net::ERR_NETWORK_CHANGED'), last]);
  await assert.rejects(runStep(page, null, navigation), (failure) => failure === last);
  assert.equal(page.calls.length, 3);
});

for (const message of ['net::ERR_NETWORK_CHANGED', 'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_CONNECTION_RESET', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_TIMED_OUT']) {
  test(`${message} is retried on a goto without any flow opt-in`, async () => {
    const page = mockPage([new Error(message)]);
    await runStep(page, null, { action: 'goto', arg: navigation.arg, retryDelayMs: 0 });
    assert.equal(page.calls.length, 2);
  });
}

for (const message of ['Navigation timeout of 60000 ms exceeded', 'net::ERR_CONNECTION_REFUSED', 'net::ERR_CERT_AUTHORITY_INVALID', 'boom']) {
  test(`a non-network error (${message}) fails at once`, async () => {
    const error = new Error(message);
    const page = mockPage([error]);
    await assert.rejects(runStep(page, null, navigation), (failure) => failure === error);
    assert.equal(page.calls.length, 1);
  });
}

test('explicit fallback still handles a connection refusal', async () => {
  const page = mockPage([new Error('net::ERR_CONNECTION_REFUSED')]);
  const fallback = 'https://example.com';
  const result = await runStep(page, null, { ...navigation, fallback });
  assert.equal(result.resolvedUrl, fallback);
  assert.equal(page.calls.length, 2);
  assert.equal(page.calls[1].url, fallback);
});

test('an unreachable name is retried first, then the explicit fallback is used', async () => {
  const dns = () => new Error('net::ERR_NAME_NOT_RESOLVED');
  const page = mockPage([dns(), dns(), dns()]);
  const fallback = 'https://example.com';
  const result = await runStep(page, null, { ...navigation, fallback });
  assert.equal(result.resolvedUrl, fallback);
  assert.equal(page.calls.length, 4);
});

test('a non-network failure after a network change is not retried or hidden by fallback', async () => {
  const error = new Error('Navigation timeout of 60000 ms exceeded');
  const page = mockPage([new Error('net::ERR_NETWORK_CHANGED'), error]);
  await assert.rejects(runStep(page, null, { ...navigation, fallback: 'https://example.com' }), (failure) => failure === error);
  assert.equal(page.calls.length, 2);
});
