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

// Runtime values are not setting names. Keep the stable control identity, not a
// user's email, card number or milestone title, in the search query.
const runtimeLabels = {
  "BillingSection.tsx:billingLoading ? \"Loading payment method\" : paymentMethod": ["Payment method"],
  "CalendarSection.tsx:connection.googleEmail || \"Google account\"": ["Google account"],
  "BoardPlanningSection.tsx:`Mark ${milestone.title} complete`": ["Mark milestone complete"],
};

function labelValues(node, file) {
  if (ts.isJsxExpression(node)) node = node.expression;
  assert.ok(node, `${file}: empty settings label`);
  const text = node.getText().replace(/\s+/g, " ");
  const runtime = runtimeLabels[`${path.basename(file)}:${text}`];
  if (runtime) return runtime;
  if (text === "eventName" && file.endsWith("WebhooksSection.tsx")) return declaration("src/lib/mcp/webhooks/events.ts", "WORKSPACE_WEBHOOK_EVENTS").elements.flatMap(strings);
  if (text === "plan.name" && file.endsWith("PlansSection.tsx")) return labelsFrom("src/lib/subscriptionPlans.ts", "storeSubscriptionPlans", "name");
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
  if (text === "label" && file.endsWith("BoardStalenessSection.tsx")) {
    const values = [];
    walk(source(file), (item) => {
      if (ts.isCallExpression(item) && item.expression.getText() === "thresholdField") values.push(...strings(item.arguments[1]));
    });
    assert.ok(values.length, `${file}: no threshold labels`);
    return values;
  }
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

function visibleText(node) {
  if (ts.isJsxText(node)) return node.text.trim();
  if (ts.isJsxElement(node)) return node.children.map(visibleText).filter(Boolean).join(" ");
  return "";
}

const exclusions = new Map([
  ["CalendarSection.tsx:Google Calendar status unavailable", "Transient error heading, not a configurable setting."],
  ["CalendarSection.tsx:Last updated", "Sync status heading, not a configurable setting."],
  ["AiUsageSection.tsx:You’ve used this month’s included AI pool", "Quota exhaustion notice heading, not a configurable setting."],
]);
const usedExclusions = new Set();
const rows = [];

function add(file, section, label) {
  label = label.replace(/\s+/g, " ").trim();
  assert.ok(words(label).length, `${file}: settings label '${label}' has no searchable words`);
  const key = `${path.basename(file)}:${label}`;
  if (exclusions.has(key)) {
    usedExclusions.add(key);
    return;
  }
  if (!rows.some((row) => row.file === file && row.section === section && row.label === label)) rows.push({ file, section, label });
}

const externalControls = new Set([
  "src/components/sidebars/RightSidebar/UserPreference.tsx",
  "src/components/sidebars/RightSidebar/Notifications Sidebar/EmailNotificationsSidebar.tsx",
  "src/components/sidebars/RightSidebar/Notifications Sidebar/PushNotificationSidebar.tsx",
]);
const primitives = new Set(["SettingsToggle", "SettingsCard", "SettingsSectionShell", "SettingsBillingRow", "SettingsMemberRow", "SettingsCodeRow"]);

function collect(file, section, seen = new Set()) {
  if (seen.has(file)) return;
  seen.add(file);
  const parsed = source(file);
  const tags = new Set();
  const labelledRows = new Set();
  walk(parsed, (node) => {
    // The shared preference component returns the inbox slice early.
    let ancestor = node.parent;
    let inboxSlice = false;
    while (ancestor) {
      if (ts.isIfStatement(ancestor) && ancestor.expression.getText() === 'variant === "inbox"') inboxSlice = true;
      ancestor = ancestor.parent;
    }
    if (file.endsWith("UserPreference.tsx") && inboxSlice !== (section === "inbox")) return;
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      tags.add(tag);
      if (tag === "UserAvatar" && file.endsWith("GeneralSection.tsx") && attr(node, "alt")) {
        for (const value of labelValues(attr(node, "alt"), file)) add(file, section, value);
      }
      const label = attr(node, "label");
      if (label && (/Row$|Toggle$|Switch$/.test(tag) || tag === "ToggleComponent")) {
        labelledRows.add(tag);
        for (const value of labelValues(label, file)) add(file, section, value);
      }
      if (tag === "BoardActionRow") {
        for (const value of labelValues(attr(node, "action"), file)) add(file, section, value);
      }
      if (["input", "select", "textarea"].includes(tag) && attr(node, "aria-label")) {
        for (const value of labelValues(attr(node, "aria-label"), file)) add(file, section, value);
      }
    }
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText();
      if (tag === "h3" && file.endsWith("BoardGeneralSection.tsx")) add(file, section, visibleText(node));
      // Forms without shared rows use their card title as the grouped control.
      if (tag === "SettingsCard" && attr(node.openingElement, "title")) {
        let hasInput = false;
        walk(node, (child) => {
          if ((ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) && /^(input|select|textarea)$/.test(child.tagName.getText())) hasInput = true;
        });
        if (hasInput) for (const value of labelValues(attr(node.openingElement, "title"), file)) add(file, section, value);
      }
      if (tag === "label") {
        const text = node.children.map(visibleText).filter(Boolean)[0];
        if (text && words(text).length) add(file, section, text);
        else {
          const expression = node.children.find((child) => ts.isJsxExpression(child) && child.expression);
          if (expression) {
            for (const value of labelValues(expression, file)) add(file, section, value);
          } else {
            // A runtime item's name is not a setting. Search for its containing
            // control, such as the GitHub skill import, instead of user content.
            let card = node.parent;
            while (card && !(ts.isJsxElement(card) && card.openingElement.tagName.getText() === "SettingsCard")) card = card.parent;
            assert.ok(card && attr(card.openingElement, "title"), `${file}: cannot collect native label`);
            for (const value of labelValues(attr(card.openingElement, "title"), file)) add(file, section, value);
          }
        }
      }
      // Inline rows use bold text next to a control instead of the shared row.
      if (["p", "span", "h3"].includes(tag) && attr(node.openingElement, "className")?.getText().includes("font-semibold")) {
        const text = visibleText(node);
        const parent = node.parent;
        if (text && words(text).length && ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === "div") {
          let hasControl = false;
          walk(parent, (child) => {
            if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) && /^(input|select|textarea|button|ChoiceButton)$/.test(child.tagName.getText())) hasControl = true;
          });
          if (hasControl) add(file, section, text);
        }
      }
    }
  });
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const names = [statement.importClause.name?.text, ...(statement.importClause.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements.map((item) => item.name.text) : [])].filter(Boolean);
    const rendered = names.filter((name) => tags.has(name));
    if (!rendered.length || rendered.every((name) => primitives.has(name) || labelledRows.has(name))) continue;
    const modulePath = statement.moduleSpecifier.text;
    const base = modulePath.startsWith("@/") ? `src/${modulePath.slice(2)}` : path.posix.join(path.posix.dirname(file), modulePath);
    const imported = [`${base}.tsx`, `${base}/index.tsx`].find((candidate) => fs.existsSync(path.join(root, candidate)));
    if (imported && (imported.startsWith(`${settingsDir}/`) || externalControls.has(imported))) collect(imported, section, seen);
  }
  // These controls render data-defined rows/options without a label prop.
  if (file.endsWith("AiDefaultModelsSection.tsx")) {
    for (const label of labelsFrom(file, "DEFAULT_MODEL_ROWS")) add(file, section, label);
  }
  if (file.endsWith("SettingsScrollPicker.tsx")) {
    for (const label of labelsFrom(file, "scrollOptions", "text")) add(file, section, label);
  }
  if (file.endsWith("AppearanceSection.tsx")) {
    for (const label of labelsFrom("src/lib/themePreferences.ts", "themeOptions", "title")) add(file, section, label);
  }
  if (file.endsWith("PushNotificationSidebar.tsx")) {
    walk(parsed, (node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "button") {
        const text = visibleText(node);
        if (text) add(file, section, text);
      }
    });
  }
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

// The section destinations themselves are settings controls too.
walk(declaration(`${settingsDir}/settingsNavigation.ts`, "SETTINGS_TABS"), (node) => {
  if (!ts.isObjectLiteralExpression(node)) return;
  const id = property(node, "id");
  const label = property(node, "label");
  if (id && label && sectionComponents.properties.some((item) => item.name.getText().replace(/["']/g, "") === strings(id)[0])) {
    add(`${settingsDir}/settingsNavigation.ts`, strings(id)[0], strings(label)[0]);
  }
});

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
  test(`${file}: ${label} -> ${section}`, (t) => {
    const covered = commands.some((command) => {
      const searchable = new Set(words(`${command.name} ${command.keywords}`));
      return command.payload === section && words(label).every((word) => searchable.has(word));
    });
    // PR 990 adds this command first. Remove only this temporary exception after rebasing:
    // https://github.com/hypertask-ai/hypertask/pull/990 (HTPR-6900).
    if (!covered && section === "board-general" && label === "Ticket prefix" && file === `${settingsDir}/BoardGeneralSection.tsx`) {
      t.skip("Ticket prefix command pending PR 990");
      return;
    }
    assert.ok(covered, `${file}: '${label}' is not findable in Ctrl+K in section '${section}'. Add a 'Settings: ${label} (...)' entry with payload '${section}' to ${commandsFile}`);
  });
}

test("non-setting exclusions have reasons and still match a rendered row", () => {
  for (const [key, reason] of exclusions) {
    assert.ok(reason.trim(), `${key}: missing exclusion reason`);
    assert.ok(usedExclusions.has(key), `${key}: stale exclusion`);
  }
});

test("literal, constant and conditional labels are collected without executing settings", () => {
  const file = `${settingsDir}/CoverageFixture.tsx`;
  sources.set(file, ts.createSourceFile(file, 'const LABEL = "Quantum preference"; const row = <SettingsToggle label={LABEL} />;', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  const start = rows.length;
  try {
    collect(file, "general");
    assert.deepEqual(rows.slice(start), [{ file, section: "general", label: "Quantum preference" }]);
    const expression = ts.createSourceFile("fixture.ts", 'const label = enabled ? "First setting" : "Second setting";', ts.ScriptTarget.Latest, true).statements[0].declarationList.declarations[0].initializer;
    assert.deepEqual(labelValues(expression, file), ["First setting", "Second setting"]);
  } finally {
    rows.splice(start);
    sources.delete(file);
  }
});

const gatedCommands = [
  { keys: ["settingsAccountsFigmaAccount"], flag: "figmaSettingsEnabled", file: "AccountsSection.tsx", uiFlag: "figmaEnabled" },
  { keys: ["settingsCalendarGoogleCalendar", "settingsCalendarGoogleAccount", "settingsCalendarKeepTasksUpdated"], flag: "googleCalendarSettingsEnabled", file: "CalendarSection.tsx", uiFlag: "enabled" },
  { keys: ["settingsTaskPageSuggestDescriptionsFromTaskTitles"], flag: "autoTaskDescriptionsEnabled", file: "src/components/sidebars/RightSidebar/UserPreference.tsx", uiFlag: "autoTaskDescriptionsEnabled" },
  { keys: ["settingsManagementKeysTeam"], flag: "teamScopedManagementKeysEnabled", file: "ManagementKeysSection.tsx", uiFlag: "teamScopedKeysEnabled" },
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
      copyCurrentUrlEnabled: true, currentProject: {}, boardLayout: "table",
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
      assert.ok(commands.some((command) => command.key === "settingsCalendar" && command.payload === "calendar"));
      assert.equal(evaluate()({ key: "settingsCalendar", commandMode: "Setting" }), true, "Calendar preferences must be accessible without the integration flag");
    }
  });
}
