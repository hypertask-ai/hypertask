const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const plan = (actions, extra = {}) => ({ ...binding, actions, expect: [], authorFamily: "grok", verifierModel: "deepseek/deepseek-v4.1-flash", ...extra });
const evidence = (extra = {}) => ({ ...binding, steps: [{ ok: true, error: "" }], expects: [], navigations: [{ url: "http://127.0.0.1:3100/", status: 200 }], offOrigin: [], ...extra });

test("missing Author-Model fails", async () => {
  const { authorGate } = await load();
  assert.deepEqual(authorGate("no model line"), { stop: true, verdict: "FAIL", notes: "author model unknown" });
  assert.equal(authorGate("Author-Model: mystery").notes, "author model unknown");
  assert.equal(authorGate("Author-Model: grok").author, "grok");
});

test("deepseek author picks the alt model and an empty alt fails", async () => {
  const { pickVerifier, decide, FLASH } = await load();
  assert.equal(pickVerifier("grok", "openai/gpt-5").model, FLASH);
  assert.equal(pickVerifier("deepseek", "openai/gpt-5").model, "openai/gpt-5");
  const picked = pickVerifier("deepseek", " ");
  assert.equal(picked.fail, "no other-family verifier configured");
  assert.equal(pickVerifier("deepseek", "deepseek/deepseek-v4.1-flash").fail, picked.fail);
  const result = decide({ model: { verdict: "PASS", notes: "" }, plan: plan([], { fail: picked.fail }), evidence: null, binding });
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.notes, picked.fail);
});

test("an empty plan is not a pass", async () => {
  const { decide } = await load();
  const result = decide({ model: { verdict: "PASS", notes: "fine" }, plan: plan([]), evidence: evidence(), binding });
  assert.deepEqual(result, { verdict: "FAIL", notes: "no user path verified" });
});

test("a failed expect fails even when the model says PASS", async () => {
  const { decide } = await load();
  const result = decide({ model: { verdict: "PASS", notes: "" }, plan: plan([{ op: "shot", name: "a" }]), evidence: evidence({ expects: [{ ok: false, error: "missing" }] }), binding });
  assert.equal(result.verdict, "FAIL");
});
test("a verdict from another attempt fails", async () => {
  const { readVerdict } = await load();
  const pass = { ...binding, verdict: "PASS", notes: "", authorFamily: "grok", verifierModel: "deepseek/deepseek-v4.1-flash" };
  assert.equal(readVerdict(JSON.stringify({ ...pass, attempt: "2" }), binding).verdict, "FAIL");
  assert.equal(readVerdict(JSON.stringify(pass), binding).verdict, "PASS");
});
