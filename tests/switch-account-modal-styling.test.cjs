const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const source = readFileSync(
  "src/components/Modals/commands/SwitchAccount/SwitchAccountModal.tsx",
  "utf8",
);

test("account switcher uses compact modal typography and one content gutter", () => {
  assert.match(
    source,
    /className="text-dense font-normal [^"]*md:max-w-\[380px\]/,
  );
  assert.match(
    source,
    /<ModalHeader className="[^"]*h-\[48px\][^"]*px-5[^"]*text-emphasis font-medium/,
  );
  assert.match(
    source,
    /<ModalBody className="[^"]*!px-5[^"]*pt-0[^"]*text-dense/,
  );
  assert.doesNotMatch(source, /<span className="text-lg">Switch account<\/span>/);
  assert.doesNotMatch(source, /className="[^"]*\b(?:p|px)-2\b[^"]*"/);
});

test("rows without a number reserve the same shortcut column as numbered accounts", () => {
  assert.match(
    source,
    /idx < 9 \?[\s\S]*?<kbd[\s\S]*?: \(\s*<span aria-hidden="true" className="w-4 shrink-0" \/>/,
  );

  const addAccountRow = source.slice(
    source.indexOf('<button\n            onClick={() => addAccount()}'),
  );
  assert.notEqual(addAccountRow, source.slice(-1));
  assert.match(
    addAccountRow,
    /<span aria-hidden="true" className="w-4 shrink-0" \/>[\s\S]*?<MdAdd/,
  );
});
