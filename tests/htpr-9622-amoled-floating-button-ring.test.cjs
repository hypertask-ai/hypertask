const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  fsCache: false,
});
const definitionModule = jiti(
  path.join(root, "src/lib/flags/definitions/htpr-9622-amoled-floating-button-ring.ts"),
);
const flag = definitionModule.HTPR_9622_AMOLED_FLOATING_BUTTON_RING_FLAG;
const amoledRingClass =
  "[.amoled_&]:[--bs-border-color:var(--border-light-gray-thin)]";

function circleClasses(enabled) {
  const load = loader({
    "@/hooks/useFlag": {
      useFlag: (key) =>
        key === flag && enabled,
    },
  });
  const MobileFloatingActionButton = load(
    "src/components/Global/MobileFloatingActionButton.tsx",
  ).default;
  const view = mount();
  try {
    view.render(
      React.createElement(MobileFloatingActionButton, {
        ariaLabel: "Create task",
        icon: null,
        onClick: () => {},
      }),
    );
    const button = view.container.querySelector('button[aria-label="Create task"]');
    assert.ok(button);
    return { classes: [...button.classList], style: button.getAttribute("style") };
  } finally {
    view.close();
  }
}

test("the AMOLED phone buttons drop the bright ring for the theme hairline", () => {
  const on = circleClasses(true);
  assert.ok(on.classes.includes(amoledRingClass));
  assert.match(amoledRingClass, /^\[\.amoled_&\]:/);
  assert.match(amoledRingClass, /var\(--border-light-gray-thin\)/);
  assert.doesNotMatch(amoledRingClass, /#|rgb|hsl/);
});

test("the ring binding is reversible and leaves every other theme and the geometry alone", () => {
  const on = circleClasses(true);
  const off = circleClasses(false);
  assert.ok(!off.classes.includes(amoledRingClass));
  assert.deepEqual(
    on.classes.filter((className) => className !== amoledRingClass),
    off.classes,
  );
  for (const className of [
    "border",
    "border-border-light-gray-thin",
    "h-12",
    "w-12",
    "rounded-full",
    "bg-modalBackground",
    "right-4",
    "z-menu",
    "md:hidden",
  ]) {
    assert.ok(off.classes.includes(className), className);
  }
  assert.equal(on.style, off.style);
  assert.match(on.style, /--mobile-dock-h/);
});

test("the AMOLED floating-button ring fix ships to everyone and can be switched off", () => {
  assert.equal(flag, "htpr-9622-amoled-floating-button-ring");
  assert.equal(definitionModule.default.kind, "bugfix");
  assert.equal(definitionModule.default.defaultMode, "EVERYONE");
  assert.equal(definitionModule.default.releaseRisk.risk, "small");
  assert.equal(definitionModule.default.releaseRisk.highRisk, undefined);
});
