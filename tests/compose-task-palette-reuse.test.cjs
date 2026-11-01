const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');

const fixturePath = path.join(__dirname, 'compose-task-palette.test.cjs');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = module.paths;
fixture._compile(`${fixtureSource.slice(0, fixtureSource.indexOf('\ntest('))}\nmodule.exports = { withPalette };`, fixturePath);
const { withPalette } = fixture.exports;

const constructible = (query) => {
  assert.equal(typeof query.QueryClient, 'function', 'the query client stays a class');
  assert.equal(new query.QueryClient().constructor, query.QueryClient, 'new QueryClient builds a QueryClient');
};

test('a palette setup leaves the real query client in the module cache', async (t) => {
  const siblingQuery = require('@tanstack/react-query');
  constructible(siblingQuery);
  await withPalette(t, { newWindow: true }, async () => {
    constructible(siblingQuery);
  });
  const afterQuery = require('@tanstack/react-query');
  assert.equal(afterQuery, siblingQuery, 'no stub proxy becomes the sibling file\'s react-query');
  constructible(afterQuery);
});
