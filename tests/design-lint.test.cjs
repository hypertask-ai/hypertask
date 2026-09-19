// The design gate is only worth having if its rules cannot be side-stepped by
// writing the same violation a slightly different way. An AI review of
// HTPR-5651 found four such holes: p-[100px] passed because every multiple of
// four was treated as valid, rounded-md and non-pixel radii were not checked,
// text-[0.875rem] slipped past a px-only matcher, and a plain white box border
// slipped past a focus-only matcher. It also found the opposite failure: the
// guide's one sanctioned 8px corner, on the mobile comment input well, was
// rejected, so a conforming edit to the reference component would go red.
//
// These cases encode both directions. A rule that stops catching its bypass
// variants, or starts rejecting a documented exception, fails here rather than
// on somebody's pull request.
//
// This is a .cjs test on purpose: design-lint has no application dependencies,
// so it runs on plain node and stays verifiable without a TypeScript loader.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LINT = pathToFileURL(
  path.resolve(__dirname, "..", "scripts", "design-lint.mjs")
).href;

const COMPONENT = "src/components/Common/Example.tsx";
const HELPER = "src/components/Common/example.ts";
const MOBILE_WELL =
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx";
const KANBAN_SECTION =
  "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx";
const CHART = "src/components/Analytics/Chart.tsx";
const THEME = "src/styles/tailwindThemes/graphite.css";

let lint;
async function load() {
  if (!lint) lint = await import(LINT);
  return lint;
}

async function rulesFor(file, text) {
  const { lintLine } = await load();
  return lintLine(file, text)
    .map((f) => f.rule)
    .sort();
}

async function fires(file, text, rule) {
  return (await rulesFor(file, text)).includes(rule);
}

test("every rule has a distinct id and an actionable fix", async () => {
  const { RULES } = await load();
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "rule ids must be unique");
  for (const rule of RULES) {
    assert.ok(
      rule.fix && rule.fix.length > 20,
      `${rule.id} needs an actionable fix line`
    );
  }
});

// A violation and its lookalike bypasses must all be caught.
const CAUGHT = [
  ["hex colour", COMPONENT, 'className="text-[#ff00aa]"', "raw-hex-colour"],
  ["rgb colour", COMPONENT, "const c = rgb(12, 34, 56);", "raw-colour-function"],
  ["hsl colour", COMPONENT, "const c = hsla(200, 10%, 20%, 0.5);", "raw-colour-function"],

  ["rounded-2xl", COMPONENT, 'className="rounded-2xl"', "banned-radius"],
  // The bypass the review found: rounded-md is 6px and off the 2/4/5 scale.
  ["rounded-md", COMPONENT, 'className="rounded-md"', "banned-radius"],
  ["rounded-lg outside the well", COMPONENT, 'className="rounded-lg"', "banned-radius"],
  ["off-scale arbitrary radius", COMPONENT, 'className="rounded-[3px]"', "banned-radius"],
  // The bypass the review found: a non-pixel arbitrary radius was unchecked.
  ["rem radius", COMPONENT, 'className="rounded-[0.5rem]"', "banned-radius"],
  ["8px radius outside the well", COMPONENT, 'className="rounded-[8px]"', "banned-radius"],

  ["tailwind gradient", COMPONENT, 'className="bg-gradient-to-r"', "gradient"],
  ["css gradient", COMPONENT, "background: linear-gradient(90deg, a, b);", "gradient"],

  ["white focus ring", COMPONENT, 'className="focus:ring-white"', "white-border"],
  ["white focus border", COMPONENT, 'className="focus:border-white-black"', "white-border"],
  // The bypass the review found: the plain border, with no focus variant.
  ["plain white border", COMPONENT, 'className="border-white"', "white-border"],
  ["plain white-black border", COMPONENT, 'className="border-white-black"', "white-border"],

  ["arbitrary px text size", COMPONENT, 'className="text-[10px]"', "arbitrary-text-size"],
  // The bypass the review found: a rem value past the px-only matcher.
  ["arbitrary rem text size", COMPONENT, 'className="text-[0.875rem]"', "arbitrary-text-size"],

  ["off-grid padding", COMPONENT, 'className="p-[13px]"', "arbitrary-spacing"],
  // The bypass the review found: on the grid, so the old rule let it through,
  // but p-[100px] still has a named equivalent and should say so.
  ["on-grid arbitrary padding", COMPONENT, 'className="p-[100px]"', "arbitrary-spacing"],
  ["on-grid arbitrary gap", COMPONENT, 'className="gap-[16px]"', "arbitrary-spacing"],
  ["rem padding", COMPONENT, 'className="px-[1.5rem]"', "arbitrary-spacing"],

  ["foreign icon set", COMPONENT, 'import { X } from "react-icons/fa";', "foreign-icon-set"],
  ["heroicons", COMPONENT, 'import { X } from "@heroicons/react/24/solid";', "foreign-icon-set"],
  ["reactstrap", COMPONENT, 'import { Button } from "reactstrap";', "foreign-ui-kit"],

  // A helper carries class strings to the screen exactly like a component does.
  ["class string in a .ts helper", HELPER, 'const c = "rounded-2xl";', "banned-radius"],
];

for (const [name, file, line, rule] of CAUGHT) {
  test(`catches ${name}`, async () => {
    const got = await rulesFor(file, line);
    assert.ok(
      got.includes(rule),
      `expected ${rule} on ${file}: ${line}\ngot: ${got.join(", ") || "nothing"}`
    );
  });
}

// Conforming code, and the exceptions the guide names by file, must stay clean.
// A gate that fires on these is worse than no gate: it gets switched off.
const CLEAN = [
  ["semantic utilities", COMPONENT, 'className="bg-cardBackground text-text-light-gray"'],
  ["sanctioned radii", COMPONENT, 'className="rounded-[2px] rounded-[4px] rounded-[5px] rounded-full"'],
  ["named radius utility", COMPONENT, 'className="rounded-sm"'],
  ["named type scale", COMPONENT, 'className="text-content text-micro text-heading"'],
  ["named spacing", COMPONENT, 'className="p-4 gap-2 px-3 mt-6"'],
  ["sanctioned half steps", COMPONENT, 'className="p-[2px] gap-[6px]"'],
  ["brand accent", COMPONENT, 'className="text-[#4455BB]"'],
  ["lucide icons", COMPONENT, 'import { Check } from "lucide-react";'],
  ["runtime-measured height", COMPONENT, "style={{ height: measuredHeight }}"],
  // The guide's named exceptions, which the review caught us rejecting.
  ["8px well radius in its own file", MOBILE_WELL, 'className="rounded-lg"'],
  ["8px arbitrary well radius", MOBILE_WELL, 'className="rounded-[8px]"'],
  ["kanban section focus ring", KANBAN_SECTION, 'className="focus:border-white-black"'],
  // Theme files are where raw colour values are supposed to live.
  ["theme file colour", THEME, "--bg-cardBackground: #262a30;"],
];

for (const [name, file, line] of CLEAN) {
  test(`allows ${name}`, async () => {
    assert.deepEqual(
      await rulesFor(file, line),
      [],
      `expected no finding on ${file}: ${line}`
    );
  });
}

test("chart colours still report; the allowlist is what excuses them", async () => {
  // The rule itself must fire. Analytics is excused in docs/design/lint-allow.txt,
  // not by a hole in the rule, so removing the allowlist entry restores the check
  // instead of silently doing nothing.
  assert.ok(await fires(CHART, 'const series = ["#ff0000"];', "raw-hex-colour"));
});

test("an on-grid arbitrary value names the utility to use instead", async () => {
  const { lintLine } = await load();
  const [finding] = lintLine(COMPONENT, 'className="p-[16px]"').filter(
    (f) => f.rule === "arbitrary-spacing"
  );
  assert.match(
    finding.message,
    /p-4/,
    "the message should name the utility to use instead"
  );
});
