const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

const INSTALLER = '.github/scripts/install-chromium.sh';

test('browser installation does not select an Ubuntu archive', () => {
  const script = fs.readFileSync(INSTALLER, 'utf8');
  assert.doesNotMatch(script, /apt-mirrors|apt-get|archive\.ubuntu\.com|--with-deps/);
  assert.match(script, /npx playwright install chromium\n/);
  assert.match(script, /browser-font-cache\.mjs/);
  const workflow = fs.readFileSync('.github/workflows/ci-tests.yml', 'utf8');
  assert.equal(workflow.split('bash .github/scripts/install-chromium.sh').length - 1, 4);
  assert.doesNotMatch(workflow, /apt-mirrors|apt-get install|playwright install --with-deps/);
});
