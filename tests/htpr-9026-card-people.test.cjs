const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-9026-card-people";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`).default;
const parts = loader()("src/lib/kanban/cardParts.ts");

function settings(enabled, onChange = () => {}) {
  const Component = loader({
    "@/hooks/useFlag": { useFlag: (key) => key === "htpr-8971-card-settings" || (key === flagKey && enabled) },
    "@/hooks/General/useCardParts": {
      useCardParts: () => parts.parseCardParts({ tags: true }),
      useSetCardPart: () => onChange,
    },
    "./SettingsSectionShell": { default: ({ children }) => React.createElement("section", null, children) },
    "./SettingsCard": { default: ({ children }) => React.createElement("div", null, children) },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  })("src/components/Modals/Settings/CardSettingsSection.tsx").default;
  return React.createElement(Component);
}

test("People ships restricted for independent design QA", () => {
  assert.equal(flag.key, flagKey);
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("legacy settings keep People on; explicit false wins", () => {
  for (const saved of [undefined, null, {}, { tags: true }, { people: true }]) {
    assert.equal(parts.parseCardParts(saved).people, true);
  }
  assert.equal(parts.parseCardParts({ people: false, tags: true }).people, false);
  assert.equal(parts.parseCardParts({ people: false, tags: true }).tags, true);
});

test("People is interactive, Name has no switch, all switches have square corners", async () => {
  const ui = mount();
  const calls = [];
  try {
    ui.render(settings(true, (...args) => calls.push(args)));
    assert.equal(ui.container.querySelector('[aria-label="Name"]'), null);
    const people = ui.container.querySelector('[aria-label="People"]');
    assert.ok(people);
    assert.equal(people.disabled, false);
    assert.equal(people.getAttribute("aria-checked"), "true");
    await React.act(async () => people.click());
    assert.deepEqual(calls, [["people", false]]);
    assert.equal(ui.container.querySelectorAll('[role="switch"]').length, parts.CARD_PARTS.length);
    assert.equal(ui.container.querySelector('[class*="rounded-full"]'), null);
  } finally {
    ui.close();
  }
});

test("flag off retains disabled Name and People controls", () => {
  const html = renderToStaticMarkup(settings(false));
  for (const name of ["name", "people"]) {
    assert.match(html, new RegExp(`<button[^>]*disabled=""[^>]*id="card-part-${name}"`));
  }
});
