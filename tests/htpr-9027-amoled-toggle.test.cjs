const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
const jiti = createJiti(__filename, { interopDefault: true, alias: { '@': path.join(root, 'src') }, fsCache: false });
const { default: definition, HTPR_9027_AMOLED_TOGGLE_FLAG: key } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-9027-amoled-toggle.ts'));
const files = [
  'src/components/Modals/Settings/SettingsToggle.tsx',
  'src/components/Modals/CustomField/ManageCustomFieldsModal.tsx',
];

test('AMOLED toggle colour ships behind its own Owner + QA flag', () => {
  assert.equal(key, 'htpr-9027-amoled-toggle');
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA');
});

for (const file of files) {
  test(`${path.basename(file)} swaps only the AMOLED on-state to the theme accent`, () => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /useFlag\(HTPR_9027_AMOLED_TOGGLE_FLAG\)/);
    assert.match(source, /checked && amoledToggle && "\[\.amoled_&\]:bg-shadcn-primary"/);
    assert.match(source, /checked \? "bg-hypertasks-green" : "bg-hover-active"/);
  });
}
