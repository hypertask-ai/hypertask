const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { analyze, buildInventory, renderReport, serializeInventory } = require("../scripts/shortcut-drift.cjs");
const baseline = require("../docs/keyboard-shortcut-inventory.json");

const binding = { scope: "Calendar", keys: ["C"], action: "create", command: "createTask", source: "calendar" };
const help = { scope: "Calendar", keys: ["C"], action: "create" };
const commands = [{ key: "createTask" }];

test("matching binding/help/command produce no diagnostic; scopes do not collide", () => {
  assert.deepEqual(analyze({ bindings: [binding], help: [help], commands }), []);
  const other = { ...binding, scope: "Board", action: "other" };
  assert.deepEqual(analyze({ bindings: [binding, other], help: [help, other], commands }), []);
});

test("a changed help key diagnoses both directions, not just title presence", () => {
  const changed = { ...help, keys: ["SHIFT", "C"] };
  assert.deepEqual(analyze({ bindings: [binding], help: [changed], commands }), [
    { category: "binding-missing-help", ...binding },
    { category: "help-without-binding", ...changed },
  ]);
});

test("duplicate registrations of the same action are not key conflicts", () => {
  assert.deepEqual(analyze({ bindings: [binding, { ...binding, source: "another-listener" }], help: [help], commands }), []);
});

const cases = new Map();
for (const platform of baseline.platforms) {
  for (const finding of platform.findings) cases.set(JSON.stringify(finding), finding);
}
for (const finding of cases.values()) {
  test(`diagnostic regression: ${finding.category} ${finding.scope} ${finding.keys.join(" ")} ${finding.action ?? finding.actions.join(" / ")}`, () => {
    const { category, ...row } = finding;
    const bindings = [];
    const help = [];
    const commands = [];
    if (category === "duplicate-keys") {
      for (const action of row.actions) {
        bindings.push({ scope: row.scope, keys: row.keys, action, command: action });
        help.push({ scope: row.scope, keys: row.keys, action });
        commands.push({ key: action });
      }
    } else if (category === "help-without-binding") {
      help.push(row);
    } else {
      bindings.push(row);
      if (category === "binding-missing-help") commands.push({ key: row.command });
      else help.push({ scope: row.scope, keys: row.keys, action: row.action });
    }
    assert.deepEqual(analyze({ bindings, help, commands }), [finding]);
    if (category === "binding-missing-help") help.push(row);
    if (category === "help-without-binding") bindings.push({ ...row, command: "covered" });
    if (category === "help-without-binding") commands.push({ key: "covered" });
    if (category === "action-missing-command") {
      bindings[0] = { ...row, command: "covered" };
      commands.push({ key: "covered" });
    }
    if (category === "duplicate-keys") {
      bindings.pop();
      help.pop();
    }
    assert.deepEqual(analyze({ bindings, help, commands }), []);
  });
}

test("live shortcut drift is report-only, including snapshot changes", (t) => {
  const globals = [global.document, global.window, global.setTimeout];
  const inventory = buildInventory();
  assert.deepEqual([global.document, global.window, global.setTimeout], globals);
  assert.equal(inventory.mode, "report-only");
  assert.deepEqual(inventory.platforms.map(({ platform }) => platform), ["Windows", "Apple"]);
  for (const platform of inventory.platforms) {
    assert.ok(platform.bindings.length > 0);
    assert.ok(platform.help.length > 0);
    assert.ok(Array.isArray(platform.composedGT));
    assert.ok(Array.isArray(platform.findings));
  }
  assert.deepEqual(buildInventory(), inventory);
  assert.deepEqual([global.document, global.window, global.setTimeout], globals);
  t.diagnostic(renderReport(inventory));
  const file = path.join(__dirname, "../docs/keyboard-shortcut-inventory.json");
  if (fs.readFileSync(file, "utf8") !== serializeInventory(inventory)) {
    t.diagnostic("Inventory changed; regenerate with node scripts/shortcut-drift.cjs --write (advisory only).");
  }
});
