const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const COMPONENT = "src/components/Global/MobileFloatingActionButton.tsx";
const FLAG = "htpr-9622-amoled-floating-button-ring";
const HAIRLINE = "[.amoled_&]:[--bs-border-color:var(--border-light-gray-thin)]";
const DOCK_BOTTOM =
  "calc(var(--mobile-dock-h, 0px) + 16px + env(safe-area-inset-bottom))";

function ringControl(enabled) {
  const reads = [];
  const Button = loadModule(COMPONENT, {
    "@/hooks/useFlag": {
      useFlag: (key) => {
        reads.push(key);
        return enabled;
      },
    },
  }).default;
  return {
    reads,
    render: (props = {}) =>
      Button({
        ariaLabel: "Create task",
        icon: null,
        onClick: () => {},
        ...props,
      }),
  };
}

function classes(button) {
  return String(button.props.className).split(/\s+/).filter(Boolean);
}

test("the phone buttons ask for the HTPR-9622 flag by its shipped key", () => {
  const control = ringControl(true);
  const button = control.render();
  assert.deepEqual(control.reads, [FLAG]);
  assert.ok(classes(button).includes(HAIRLINE));
});

test("the smaller stacked AI button keeps its size and takes the AMOLED hairline", () => {
  const button = ringControl(true).render({ size: "secondary", stackOffset: 60 });
  const applied = classes(button);
  assert.ok(applied.includes("h-10"));
  assert.ok(applied.includes("w-10"));
  assert.ok(applied.includes(HAIRLINE));
});

test("the default phone button keeps its larger size and takes the AMOLED hairline", () => {
  const applied = classes(ringControl(true).render());
  assert.ok(applied.includes("h-12"));
  assert.ok(applied.includes("w-12"));
  assert.ok(applied.includes(HAIRLINE));
});

test("the stack offset and dock offset are unchanged by the ring switch", () => {
  const control = ringControl(true);
  assert.equal(
    control.render({ size: "secondary", stackOffset: 60 }).props.style.transform,
    "translateY(-60px)",
  );
  assert.equal(control.render().props.style.bottom, DOCK_BOTTOM);
  assert.equal(
    control.render({ bottomOffset: 72 }).props.style.bottom,
    "calc(72px + 16px)",
  );
});

test("every render asks the flag hook again and keeps the same ring", () => {
  const control = ringControl(true);
  const first = control.render();
  const second = control.render();
  assert.deepEqual(control.reads, [FLAG, FLAG]);
  assert.equal(classes(second).join(" "), classes(first).join(" "));
});

test("switching the flag off restores the plain border and moves nothing else", () => {
  const props = { size: "secondary", stackOffset: 60 };
  const on = ringControl(true).render(props);
  const off = ringControl(false).render(props);
  const offClasses = classes(off);
  assert.ok(!offClasses.includes(HAIRLINE));
  assert.ok(!offClasses.some((name) => name.includes("--bs-border-color")));
  assert.deepEqual(classes(on).filter((name) => name !== HAIRLINE), offClasses);
  assert.deepEqual(on.props.style, off.props.style);
  assert.equal(on.props.className, on.props.className.trim());
  assert.equal(off.props.className, off.props.className.trim());
  for (const name of ["border", "border-border-light-gray-thin", "rounded-full", "md:hidden"]) {
    assert.ok(offClasses.includes(name), name);
  }
});
