import { readFileSync } from 'node:fs';

let report;
try { report = JSON.parse(readFileSync(process.argv[2], 'utf8')); } catch { report = {}; }
const list = (value) => Array.isArray(value) ? value : [];
const errors = [...list(report?.errors)];
function collect(suite) {
  for (const spec of list(suite?.specs)) for (const test of list(spec?.tests)) {
    for (const result of list(test?.results)) errors.push(...list(result?.errors), result?.error);
  }
  for (const child of list(suite?.suites)) collect(child);
}
for (const suite of list(report?.suites)) collect(suite);
const first = errors.find((error) => typeof error?.message === 'string' && error.message.trim());
const line = first?.message.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)[0].trim().replace(/^(?:Error:\s*)?["']?/, '') || '';
let reason;
if (/^route\.fetch: Test ended\./i.test(line)) reason = 'route.fetch: Test ended.';
else if (/^(?:Test timeout of \d+ms exceeded|Timeout of \d+ms exceeded)/i.test(line)) reason = 'Test timeout exceeded';
else if (/^page\.goto:\s*net::ERR_[A-Z_]+\b/i.test(line)) reason = 'page.goto: network error';
else if (/^page\.goto:/i.test(line)) reason = 'page.goto failed';
else if (/^(?:Error:\s*)?expect\(/i.test(line)) reason = 'expect assertion failed';
console.log(reason || (first ? 'Smoke error details withheld for safety' : 'No Playwright error was recorded'));
