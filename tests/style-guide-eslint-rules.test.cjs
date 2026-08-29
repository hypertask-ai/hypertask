const assert = require("node:assert/strict");
const test = require("node:test");
const { Linter } = require("eslint");

const pluginPromise = import("../eslint-local-rules/style-guide.mjs");

async function lint(code, filename = "src/components/TestComponent.tsx") {
  const { styleGuideLintConfig } = await pluginPromise;
  const testConfig = { ...styleGuideLintConfig, files: ["**/*.tsx"] };
  const linter = new Linter();
  return linter.verify(code, [testConfig], { filename });
}

function ruleIds(messages) {
  return messages.map((message) => message.ruleId);
}

test("rejects raw Tailwind color scales while allowing theme tokens", async () => {
  const invalid = await lint(
    '<div className="text-red-400 hover:bg-blue-500 border-gray-300 ring-red-500 from-purple-500 divide-slate-400" />;',
  );
  assert.equal(
    ruleIds(invalid).filter(
      (ruleId) => ruleId === "hypertask-style/no-raw-tailwind-colors",
    ).length,
    6,
  );

  const valid = await lint(
    '<div className="text-text-light-gray bg-modalBackground border-border-light-gray-thin" />;',
  );
  assert.deepEqual(valid, []);
});

test("rejects unapproved color literals in className and style props", async () => {
  const invalid = await lint(`
    <div
      className={condition ? "bg-[#123456]" : "text-[rgba(1, 2, 3, 0.5)]"}
      style={{ color: "rgb(1, 2, 3)", borderColor: "hsl(10 20% 30%)" }}
    />;
  `);
  assert.equal(
    ruleIds(invalid).filter(
      (ruleId) => ruleId === "hypertask-style/no-unapproved-color-literals",
    ).length,
    4,
  );

  const valid = await lint(`
    <div
      className="bg-[#333B47]"
      style={{ color: "rgb(35,131,226)" }}
    />;
  `);
  assert.deepEqual(valid, []);
});

test("rejects forbidden outlines, gradients, radii, and shadows", async () => {
  const messages = await lint(`
    <div className="border-white focus:border-white-black bg-gradient-to-r bg-linear-to-r bg-radial bg-conic rounded-lg rounded-xl rounded-2xl rounded-3xl rounded-4xl shadow-lg" />;
  `);
  assert.equal(
    ruleIds(messages).filter(
      (ruleId) => ruleId === "hypertask-style/no-forbidden-utilities",
    ).length,
    12,
  );

  const valid = await lint('<img className="rounded-full" />;');
  assert.deepEqual(valid, []);
});

test("allows the established section keyboard-focus border only in section components", async () => {
  const focusCode = '<section className="focus:border-white-black focus-visible:border-white-black" />;';
  const allowed = await lint(
    focusCode,
    "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
  );
  assert.deepEqual(allowed, []);

  const rejected = await lint(focusCode);
  assert.equal(
    ruleIds(rejected).filter(
      (ruleId) => ruleId === "hypertask-style/no-forbidden-utilities",
    ).length,
    2,
  );

  const unqualified = await lint('<section className="border-white-black" />;');
  assert.deepEqual(ruleIds(unqualified), [
    "hypertask-style/no-forbidden-utilities",
  ]);
});

test("Tailwind no-custom-classname accepts configured utilities and rejects unknown classes", async () => {
  const valid = await lint('<div className="flex bg-modalBackground" />;');
  assert.deepEqual(valid, []);

  const invalid = await lint('<div className="invented-panel" />;');
  assert.ok(ruleIds(invalid).includes("tailwindcss/no-custom-classname"));
});
