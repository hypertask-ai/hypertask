const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const compare = require("../scripts/lib/pstack-compare.cjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const goto = (path) => ({ op: "goto", path });
const okRun = (overrides = {}) => ({
  steps: [{ action: goto("/inbox"), ok: true }],
  expects: [{ expect: { text: "Inbox" }, ok: true }],
  navigations: [{ url: "http://127.0.0.1:3000/inbox", status: 200 }],
  offOrigin: [],
  ...overrides,
});

test("the verifier knows a desktop size and a phone size", async () => {
  const { VIEWPORTS, VIEWPORT_NAMES } = await load();
  assert.deepEqual(VIEWPORT_NAMES, ["desktop", "phone"]);
  const desktop = VIEWPORTS.find((item) => item.name === "desktop").options;
  const phone = VIEWPORTS.find((item) => item.name === "phone").options;
  assert.deepEqual(desktop.viewport, { width: 1440, height: 900 });
  assert.deepEqual(phone.viewport, { width: 390, height: 844 });
  assert.equal(phone.isMobile, true);
  assert.equal(phone.hasTouch, true);
});

test("journey evidence carries its viewport and refuses one the verifier cannot drive", async () => {
  const { readJourneyEvidence, JOURNEY_RUN_LIMIT } = await load();
  const body = (journeys) => ({ ...binding, journeys });
  const tagged = readJourneyEvidence(JSON.stringify(body([{ journey: "area:inbox", viewport: "phone", steps: [], expects: [] }])), binding);
  assert.equal(tagged.journeys[0].viewport, "phone");
  assert.throws(() => readJourneyEvidence(JSON.stringify(body([{ journey: "area:inbox", viewport: "tablet", steps: [], expects: [] }])), binding), /schema\/binding mismatch/);
  assert.throws(() => readJourneyEvidence(JSON.stringify(body(Array.from({ length: JOURNEY_RUN_LIMIT + 1 }, () => ({ journey: "area:inbox", steps: [], expects: [] })))), binding), /schema\/binding mismatch/);
});

test("a failure that only shows at phone width fails and names the phone viewport", () => {
  const result = compare.decideHeadOnly({ journeys: [
    { journey: "area:inbox", viewport: "desktop", head: okRun() },
    { journey: "area:inbox", viewport: "phone", head: okRun({ steps: [{ action: goto("/inbox"), ok: true }, { action: goto("/inbox"), ok: false }] }) },
  ] });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /area:inbox \[phone\]: failed at step 2/);
  assert.doesNotMatch(result.notes, /area:inbox \[desktop\]:/);
});

test("a phone lane that never ran could not be evaluated rather than passing on desktop alone", () => {
  const result = compare.decideHeadOnly({ journeys: [
    { journey: "area:inbox", viewport: "desktop", head: okRun() },
    { journey: "area:inbox", viewport: "phone", head: null },
  ] });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /area:inbox \[phone\]: the run did not finish/);
});

test("the judge is asked once per viewport and reports the one that broke", async () => {
  const { judgeJourneys } = await load();
  const plan = { ...binding, authorFamily: "grok", verifierModel: "deepseek/deepseek-v4.1-flash", viewports: ["desktop", "phone"], actions: [goto("/inbox")], expect: [{ text: "Inbox" }], journeys: [{ journey: "change:primary", actions: [goto("/inbox")], expect: [{ text: "Inbox" }] }] };
  const runs = (desktop, phone) => [
    { journey: "change:primary", viewport: "desktop", ...okRun({ expects: [{ expect: { text: "Inbox" }, ok: desktop }] }) },
    { journey: "change:primary", viewport: "phone", ...okRun({ expects: [{ expect: { text: "Inbox" }, ok: phone }] }) },
  ];
  const asked = [];
  const judged = await judgeJourneys({
    plan,
    evidence: { ...binding, journeys: runs(true, false) },
    picked: { model: plan.verifierModel },
    ask: async () => { asked.push(1); return { verdict: "PASS", notes: "saw the field" }; },
    work: "",
  });
  assert.equal(judged.verdict, "FAIL");
  assert.match(judged.notes, /change:primary \[phone\]: failed at step/);
  assert.doesNotMatch(judged.notes, /change:primary \[desktop\]/);
  assert.equal(asked.length, 1);
});

test("a plan without journeys still fails when the phone run broke", async () => {
  const { decide } = await load();
  const evidence = { ...binding, steps: [{ ok: true, error: "" }], expects: [], navigations: [{ url: "http://127.0.0.1:3000/inbox", status: 200 }], offOrigin: [], journeys: [
    { journey: "change:primary", viewport: "desktop", steps: [{ action: goto("/inbox"), ok: true }], expects: [], navigations: [{ url: "http://127.0.0.1:3000/inbox", status: 200 }], offOrigin: [] },
    { journey: "change:primary", viewport: "phone", steps: [{ action: goto("/inbox"), ok: false }], expects: [], navigations: [{ url: "http://127.0.0.1:3000/inbox", status: 200 }], offOrigin: [] },
  ] };
  const result = decide({ model: { verdict: "PASS", notes: "" }, plan: { ...binding, actions: [goto("/inbox")], expect: [], authorFamily: "grok", verifierModel: "deepseek/deepseek-v4.1-flash" }, evidence, binding });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /a step failed at phone/);
});
