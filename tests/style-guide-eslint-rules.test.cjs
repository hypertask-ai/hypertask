const assert = require("node:assert/strict");
const test = require("node:test");
const { ESLint, Linter } = require("eslint");
const path = require("node:path");
const radiusBaseline = require("../eslint-local-rules/radius-baseline.json");

const pluginPromise = import("../eslint-local-rules/style-guide.mjs");

async function lint(code, filename = "src/components/TestComponent.tsx", options = {}) {
  const { styleGuideLintConfig } = await pluginPromise;
  const testConfig = {
    ...styleGuideLintConfig,
    files: ["**/*.tsx"],
    rules: {
      ...styleGuideLintConfig.rules,
      "hypertask-style/no-forbidden-utilities": ["error", options],
    },
  };
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

test("rejects arbitrary corner sizes and names the approved replacements", async () => {
  const tokens = [
    "rounded-[5px]",
    "rounded-t-[6px]",
    "hover:rounded-tr-[3px]",
    "[.amoled_&]:rounded-[5px]",
    "!rounded-s-[1rem]",
    "rounded-ee-[50%]!",
    "rounded-[var(--bs-border-radius)]",
    "rounded-[calc(var(--radius-chat-window)+1px)]",
    "[--bs-border-radius:5px]",
    "[.amoled_&]:[--bs-border-radius:5px]",
    "hover:![--bs-border-radius:6px]",
    "[--radius-chat-window:8px]!",
    "[border-radius:6px]",
    "hover:[border-top-left-radius:3px]",
  ];
  for (const token of tokens) {
    const messages = (await lint(`<div className="${token}" />;`)).filter(
      (message) => message.ruleId === "hypertask-style/no-forbidden-utilities",
    );
    assert.equal(messages.length, 1, token);
    assert.equal(
      messages[0].message,
      `Corners are 0, 2 or 4px only: use rounded-[2px] or rounded-[4px] instead of '${token}'.`,
    );
  }
});

test("allows approved arbitrary corner sizes and radius tokens", async () => {
  for (const value of ["0", "0px", "2px", "4px", "var(--radius-chat-window)", "var(--radius-chat-sheet)"]) {
    const messages = await lint(`<div className="rounded-[${value}] hover:rounded-t-[${value}] !rounded-es-[${value}] rounded-bl-[${value}]! [--bs-border-radius:${value}] hover:![--radius-chat-window:${value}] [border-radius:${value}] [border-bottom-right-radius:${value}]!" />;`);
    assert.deepEqual(messages, [], value);
  }
  assert.deepEqual(await lint('<div className="[--panel-width:5px] hover:bg-modalBackground rounded-none rounded-full" />;'), []);
});

test("checks arbitrary corners in conditional and template class names", async () => {
  const messages = await lint('<div className={enabled ? "rounded-[5px]" : `rounded-t-[6px] ${extra}`} />;');
  assert.equal(ruleIds(messages).filter((ruleId) => ruleId === "hypertask-style/no-forbidden-utilities").length, 2);
});

test("radius baseline cannot grow beyond the 302 violations recorded in HTPR-9611", () => {
  for (const [filename, count] of Object.entries(radiusBaseline)) {
    assert.ok(filename.startsWith("src/") && filename.endsWith(".tsx"), filename);
    assert.ok(Number.isInteger(count) && count > 0, filename);
  }
  assert.ok(Object.values(radiusBaseline).reduce((sum, count) => sum + count, 0) <= 302);
});

test("radius allowance is per file and reports only later violations beyond its count", async () => {
  const [filename, allowance] = Object.entries(radiusBaseline)[0];
  const existing = Array.from({ length: allowance }, () => '<div className="rounded-[5px]" />;').join("\n");
  assert.deepEqual(await lint(existing, filename), []);
  assert.deepEqual(await lint(existing, path.resolve(filename)), []);
  assert.deepEqual(await lint('<div className="rounded-[2px]" />;', filename), []);
  const code = `${existing}\n<div className="rounded-t-[6px]" />;\n<div className="rounded-[8px]" />;`;
  const messages = await lint(code, filename);
  assert.deepEqual(messages.map((message) => message.line), [allowance + 1, allowance + 2]);
  assert.ok(messages.every((message) => message.messageId === "forbiddenRadius"));
  assert.equal((await lint(existing)).length, allowance);
  assert.equal((await lint(existing, filename, { ignoreRadiusBaseline: true })).length, allowance);
  const unrelated = await lint('<div className="bg-gradient-to-r shadow-lg" />;', filename);
  assert.equal(unrelated.length, 2);
  assert.ok(unrelated.every((message) => message.messageId === "forbiddenUtility"));
});

test("radius allowance does not combine with legacy ESLint suppressions", async () => {
  const filename = "src/app/[...boardURL]/error.tsx";
  const eslint = new ESLint({
    applySuppressions: true,
    suppressionsLocation: path.resolve("eslint-local-rules/style-guide-suppressions.json"),
  });
  const existing = Array.from({ length: radiusBaseline[filename] }, () => '<div className="rounded-lg" />;').join("\n");
  const code = `<div className="bg-gradient-to-r" />;\n${existing}`;
  const [valid] = await eslint.lintText(code, { filePath: filename });
  assert.deepEqual(valid.messages, []);
  const [invalid] = await eslint.lintText(`${code}\n<div className="rounded-[5px]" />;`, { filePath: filename });
  assert.ok(invalid.messages.some((message) => message.messageId === "forbiddenRadius"));
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
