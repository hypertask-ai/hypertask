// Coverage contract: only SettingsToggle label props count, including
// ToggleComponent labels when the section explicitly injects SettingsToggle.
// Follow rendered section-content components, not modal/dialog/form/editor
// subtrees or entity list items (.map containers keyed by a runtime item's .id).
// SettingsCard/SettingsSectionShell headings, BillingRow status values,
// BillingActionRow/BoardActionRow actions, SettingsMemberRow list items,
// SettingsCodeRow editors, buttons and native form fields do not count.
// BoardTicketPrefixSetting is the one native-row exception: its labelled
// settings-ticket-prefix control predates SettingsToggle and is collected
// explicitly. New settings toggles using the shared
// component are collected automatically; unresolved labels fail closed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const settingsDir = "src/components/Modals/Settings";
const commandsFile = "src/components/Modals/commands/HTC/AllCommands.ts";
const sources = new Map();

function source(file) {
  if (!sources.has(file)) {
    const parsed = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(parsed.parseDiagnostics.length, 0, `Cannot parse ${file}`);
    sources.set(file, parsed);
  }
  return sources.get(file);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function unwrap(node) {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function declaration(file, name) {
  let found;
  walk(source(file), (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === name) found = node.initializer;
  });
  assert.ok(found, `${file}: missing declaration ${name}`);
  return unwrap(found);
}

function property(node, name) {
  return node.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText().replace(/["']/g, "") === name)?.initializer;
}

function strings(node) {
  node = unwrap(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue), ...strings(node.whenFalse)];
  throw new Error(`Unresolved settings label: ${node.getText()}. Teach this check to collect its source, do not allowlist a setting.`);
}

function labelsFrom(file, name, field = "label") {
  const node = declaration(file, name);
  const items = ts.isArrayLiteralExpression(node) ? node.elements : node.properties.map((item) => item.initializer);
  return items.flatMap((item) => strings(property(unwrap(item), field)));
}

function labelValues(node, file) {
  if (ts.isJsxExpression(node)) node = node.expression;
  assert.ok(node, `${file}: empty settings label`);
  const text = node.getText().replace(/\s+/g, " ");
  if (text === "provider.label") return labelsFrom("src/lib/aiProviders.ts", "AI_PROVIDERS");
  if (text === "row.label" && file.endsWith("ApiKeysSection.tsx")) {
    return [...labelsFrom("src/lib/aiProviders.ts", "AI_PROVIDERS"), ...strings(property(declaration("src/lib/aiProviders.ts", "AI_GATEWAY_BYOK_PROVIDER"), "label"))];
  }
  if (text === "AI_FEATURES[feature].label") {
    const features = declaration("src/lib/systemModelLadder.ts", "AI_FEATURES");
    const labels = [];
    walk(declaration(file, "FEATURE_SECTIONS"), (item) => {
      if (ts.isPropertyAssignment(item) && item.name.getText() === "feature") labels.push(...strings(property(unwrap(property(features, strings(item.initializer)[0])), "label")));
    });
    assert.ok(labels.length, `${file}: no AI feature labels`);
    return labels;
  }
  if (text === "label" && file.endsWith("NotificationMatrix.tsx")) return labelsFrom(file, "notificationRows");
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const parts = labelValues(span.expression, file);
      values = values.flatMap((prefix) => parts.map((part) => prefix + part + span.literal.text));
    }
    return values;
  }
  if (ts.isIdentifier(node)) return labelValues(declaration(file, node.text), file);
  return strings(node);
}

function attr(node, name) {
  return node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText() === name)?.initializer;
}

const rows = [];
const primitives = new Set(["SettingsCard", "SettingsSectionShell", "SettingsBillingRow", "SettingsMemberRow", "SettingsCodeRow"]);

function add(file, section, label) {
  label = label.replace(/\s+/g, " ").trim();
  assert.ok(words(label).length, `${file}: settings label '${label}' has no searchable words`);
  if (!rows.some((row) => row.file === file && row.section === section && row.label === label)) rows.push({ file, section, label });
}

function component(file, name) {
  const parsed = source(file);
  if (name === "default") {
    const exported = parsed.statements.find(ts.isExportAssignment);
    if (exported) return ts.isIdentifier(exported.expression) ? component(file, exported.expression.text) : exported.expression;
    return parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  }
  let found;
  walk(parsed, (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === name) found = node.initializer;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
  });
  return found;
}

function collect(file, section, name = "default", injectedToggle = false, seen = new Set()) {
  const key = `${file}:${name}:${injectedToggle}`;
  if (seen.has(key)) return;
  seen.add(key);
  const parsed = source(file);
  const entry = component(file, name);
  assert.ok(entry, `${file}: cannot resolve settings component ${name}`);
  const imports = new Map();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const modulePath = statement.moduleSpecifier.text;
    const base = modulePath.startsWith("@/") ? `src/${modulePath.slice(2)}` : path.posix.join(path.posix.dirname(file), modulePath);
    const imported = [`${base}.tsx`, `${base}/index.tsx`].find((candidate) => fs.existsSync(path.join(root, candidate)));
    if (!imported) continue;
    if (statement.importClause.name) imports.set(statement.importClause.name.text, { file: imported, name: "default" });
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) imports.set(item.name.text, { file: imported, name: item.propertyName?.text ?? item.name.text });
    }
  }
  const isToggle = (tag) => imports.get(tag)?.file === `${settingsDir}/SettingsToggle.tsx` || (injectedToggle && tag === "ToggleComponent");
  function visit(node) {
    // UserPreference renders a different slice when used by InboxSection.
    if (file.endsWith("UserPreference.tsx") && ts.isIfStatement(node) && node.expression.getText() === 'variant === "inbox"') {
      if (section === "inbox") visit(node.thenStatement);
      return;
    }
    if (file.endsWith("UserPreference.tsx") && section === "inbox" && ts.isReturnStatement(node) && node.parent === entry.body) return;
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const tag = opening.tagName.getText();
      if (/Modal|Dialog|Editor/.test(tag) || tag === "form" || tag === "dialog") return;
      const itemKey = attr(opening, "key");
      if (itemKey && ts.isJsxExpression(itemKey) && itemKey.expression && ts.isPropertyAccessExpression(itemKey.expression) && itemKey.expression.name.text === "id") {
        let ancestor = node.parent;
        while (ancestor && ancestor !== entry) {
          if (ts.isCallExpression(ancestor) && ts.isPropertyAccessExpression(ancestor.expression) && ancestor.expression.name.text === "map") return;
          ancestor = ancestor.parent;
        }
      }
      if (isToggle(tag)) {
        assert.ok(attr(opening, "label"), `${file}: settings toggle has no label`);
        for (const label of labelValues(attr(opening, "label"), file)) add(file, section, label);
        return;
      }
      if (file === `${settingsDir}/BoardGeneralSection.tsx` && name === "BoardTicketPrefixSetting" && tag === "label" && attr(opening, "htmlFor")?.text === "settings-ticket-prefix") {
        add(file, section, node.children.filter(ts.isJsxText).map((child) => child.text).join(" "));
      }
      const imported = imports.get(tag);
      const toggle = attr(opening, "ToggleComponent");
      const inject = toggle && ts.isJsxExpression(toggle) && isToggle(toggle.expression?.getText());
      if (imported && imported.file !== `${settingsDir}/SettingsToggle.tsx` && !primitives.has(tag) && (imported.file.startsWith(`${settingsDir}/`) || inject)) {
        collect(imported.file, section, imported.name, Boolean(inject), seen);
      } else if (!imported && /^[A-Z]/.test(tag) && component(file, tag)) {
        collect(file, section, tag, false, seen);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(entry);
}

const shell = `${settingsDir}/SettingsShell.tsx`;
const sectionComponents = declaration(shell, "SECTION_COMPONENTS");
for (const item of sectionComponents.properties) {
  const section = item.name.getText().replace(/["']/g, "");
  const component = item.initializer.getText();
  const dynamic = declaration(shell, component);
  let modulePath;
  walk(dynamic, (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) modulePath = node.arguments[0].text;
  });
  assert.ok(modulePath, `${shell}: cannot resolve ${section}`);
  assert.ok(source(`${settingsDir}/settingsNavigation.ts`).text.includes(`"${section}"`), `Unknown section ${section}`);
  collect(path.posix.join(settingsDir, `${modulePath}.tsx`), section);
}

const commands = [];
walk(source(commandsFile), (node) => {
  if (!ts.isObjectLiteralExpression(node)) return;
  if (property(node, "commandMode")?.getText() !== "CommandMode.Setting") return;
  const payload = property(node, "payload");
  if (!payload) return;
  commands.push({
    key: strings(property(node, "key"))[0],
    payload: strings(payload)[0],
    name: strings(property(node, "name"))[0],
    keywords: property(node, "keywords") ? strings(property(node, "keywords"))[0] : "",
  });
});

function words(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

assert.ok(rows.length > 0, "No settings rows collected");
assert.ok(commands.length > 0, "No settings commands collected");
for (const { file, section, label } of rows) {
  test(`${file}: ${label} -> ${section}`, () => {
    const covered = commands.some((command) => {
      const searchable = new Set(words(`${command.name} ${command.keywords}`));
      return command.payload === section && words(label).every((word) => searchable.has(word));
    });
    assert.ok(covered, `${file}: '${label}' is not findable in Ctrl+K in section '${section}'. Add a 'Settings: ${label} (...)' entry with payload '${section}' to ${commandsFile}`);
  });
}

test("only shared settings toggles on section content are collected", () => {
  const file = `${settingsDir}/CoverageFixture.tsx`;
  const fixture = `
    import Toggle from "./SettingsToggle";
    const LABEL = "Quantum preference";
    const UnusedEditor = () => <Toggle label="Unused editor toggle" />;
    const EditModal = () => <Toggle label="Dialog toggle" />;
    const Content = () => <Toggle label={enabled ? "First setting" : "Second setting"} />;
    export default function Section() { return <SettingsSectionShell title="Heading">
      <Toggle label={LABEL} key={project.id} /><Content /><EditModal />
      <Dialog><Toggle label="Nested dialog toggle" /><input aria-label="Milestone title" /></Dialog>
      <form><Toggle label="Form toggle" /></form>
      <SkillEditor><Toggle label="Editor toggle" /></SkillEditor>
      {items.map((item) => <div key={item.id}><Toggle label="Enabled" /></div>)}
      <button>Edit skill</button><label>New skill</label><input aria-label="Health update" />
      <SettingsCard title="Import from GitHub"><textarea aria-label="Editor" /></SettingsCard>
      <BillingRow label="Status" /><BillingActionRow label="Action" />
      <BoardActionRow action="Archive board" /><ToggleSwitch label="Enabled" />
      <h3>Heading</h3><p className="font-semibold">Status text</p>
    </SettingsSectionShell>; }
  `;
  sources.set(file, ts.createSourceFile(file, fixture, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  const start = rows.length;
  try {
    collect(file, "general");
    assert.deepEqual(rows.slice(start).map((row) => row.label), ["Quantum preference", "First setting", "Second setting"]);
  } finally {
    rows.splice(start);
    sources.delete(file);
  }
});

test("unresolved shared row labels fail rather than silently dropping a setting", () => {
  const file = `${settingsDir}/CoverageFixture.tsx`;
  sources.set(file, ts.createSourceFile(file, 'import SettingsToggle from "./SettingsToggle"; export default () => <SettingsToggle label={unknown.label} />;', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  try {
    assert.throws(() => collect(file, "general"), /Unresolved settings label/);
  } finally {
    sources.delete(file);
  }
});

const gatedCommands = [
  { keys: ["settingsCalendarKeepTasksUpdated"], flag: "googleCalendarSettingsEnabled", file: "CalendarSection.tsx", uiFlag: "enabled" },
  { keys: ["settingsTaskPageSuggestDescriptionsFromTaskTitles"], flag: "autoTaskDescriptionsEnabled", file: "src/components/sidebars/RightSidebar/UserPreference.tsx", uiFlag: "autoTaskDescriptionsEnabled" },
];

for (const { keys, flag, file, uiFlag } of gatedCommands) {
  test(`settings commands respect the UI flag: ${flag}`, () => {
    const menuFile = "src/components/Modals/commands/HTC/commands.tsx";
    const flagKey = (file, name) => {
      const call = declaration(file, name);
      assert.equal(call.expression.getText(), "useFlag");
      const key = call.arguments[0];
      return ts.isStringLiteral(key) ? key.text : strings(declaration("src/lib/flags/keys.ts", key.getText()))[0];
    };
    assert.equal(flagKey(menuFile, flag), flagKey(file.startsWith("src/") ? file : `${settingsDir}/${file}`, uiFlag));
    let predicate;
    let dependencies;
    walk(source(menuFile), (node) => {
      if (ts.isCallExpression(node) && node.expression.getText().replace(/\s+/g, "") === "group.commandLists.filter") predicate = node.arguments[0];
      if (ts.isCallExpression(node) && node.expression.getText() === "useMemo" && node.arguments[0].getText().includes("getAllCommands")) dependencies = node.arguments[1];
    });
    assert.ok(predicate, "Command availability filter missing");
    assert.ok(dependencies.elements.some((item) => item.getText() === flag), `${flag}: missing memo dependency`);
    const bindings = {
      CommandMode: new Proxy({}, { get: (_, key) => key }), showByokApiKeys: true,
      copyCurrentUrlEnabled: true, isTicketPrefixCommandVisible: () => true, currentProject: {}, boardLayout: "table",
      onMyTasks: false, myTasksViewsEnabled: false, myTasksTableColumnsEnabled: false,
      onCalendar: false,
      ...Object.fromEntries(gatedCommands.map((item) => [item.flag, false])),
    };
    const js = ts.transpileModule(`const filter = ${predicate.getText()};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const evaluate = () => new Function(...Object.keys(bindings), `${js}; return filter;`)(...Object.values(bindings));
    for (const key of keys) {
      assert.ok(commands.some((command) => command.key === key), `Missing gated settings command ${key}`);
      assert.equal(evaluate()({ key, commandMode: "Setting" }), false, `${key} visible while flag off`);
      bindings[flag] = true;
      assert.equal(evaluate()({ key, commandMode: "Setting" }), true, `${key} absent while flag on`);
      bindings[flag] = false;
    }
    assert.equal(evaluate()({ key: "settingsGeneral", commandMode: "Setting" }), true, "Unrelated settings were gated");
    if (flag === "googleCalendarSettingsEnabled") {
      assert.equal(evaluate()({ key: "settingsCalendarShowWeekends", commandMode: "Setting" }), true, "Calendar preferences must be accessible without the integration flag");
    }
  });
}
