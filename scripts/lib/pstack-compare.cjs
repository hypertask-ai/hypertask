const { createHash } = require("node:crypto");

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const RUN_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+\/attempts\/[0-9]+$/;
const PASS_VERDICTS = ["PASS", "PASS+NOTES"];

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function firstFailure(steps, expects) {
  for (const [index, step] of steps.entries()) if (step?.ok !== true) return index;
  for (const [index, expect] of expects.entries()) if (expect?.ok !== true) return steps.length + index;
  return -1;
}

function plannedActions(run, plan) {
  if (Array.isArray(plan?.actions) && plan.actions.length) return plan.actions;
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const actions = steps.map((step) => step?.action);
  return actions.length && actions.every((action) => action && typeof action === "object") ? actions : null;
}

function apiOnlyRun(run, plan) {
  if (run?.apiOnly === true) return true;
  const actions = plannedActions(run, plan);
  return actions ? actions.every((action) => action.op === "api") : false;
}

function judgedVerdict(run) {
  const field = run?.judged && typeof run.judged === "object" ? run.judged.verdict : run?.judged;
  return String(field ?? "").trim().toUpperCase();
}

function classifyRun(run, plan) {
  if (!run || run.preview === "down") return { state: "unavailable", failIndex: -1 };
  const steps = Array.isArray(run.steps) ? run.steps : null;
  const expects = Array.isArray(run.expects) ? run.expects : null;
  if (!steps || !expects) return { state: "unavailable", failIndex: -1 };
  const index = firstFailure(steps, expects);
  const tail = steps.length + expects.length;
  if (index >= 0) return { state: "failed", failIndex: index };
  const navigations = Array.isArray(run.navigations) ? run.navigations : [];
  const badNav = navigations.some((item) => !(Number(item?.status) >= 200 && Number(item?.status) < 400));
  if (badNav || (Array.isArray(run.offOrigin) && run.offOrigin.length)) return { state: "failed", failIndex: tail };
  if (!apiOnlyRun(run, plan) && navigations.length === 0) return { state: "failed", failIndex: tail };
  const judged = judgedVerdict(run);
  if (judged === "UNEVALUATED") return { state: "unjudged", failIndex: -1 };
  if (judged && !PASS_VERDICTS.includes(judged)) return { state: "failed", failIndex: tail };
  return { state: "ok", failIndex: -1 };
}

function failureNote(run, failIndex) {
  const stepsPassed = (run?.steps ?? []).every((step) => step?.ok === true) && (run?.expects ?? []).every((expect) => expect?.ok === true);
  const judged = judgedVerdict(run);
  const judgedFail = judged !== "" && judged !== "UNEVALUATED" && !PASS_VERDICTS.includes(judged);
  return stepsPassed && judgedFail ? "the judge failed it" : `failed at step ${failIndex + 1}`;
}

function areaOf(journey) {
  const value = String(journey ?? "");
  return value.startsWith("area:") ? value.slice(5) : "";
}

function decideHeadOnly({ journeys, redFeatures = [], bugfix = false, bugfixUnevaluated = "", bugfixProved = false } = {}) {
  const list = (Array.isArray(journeys) ? journeys : []).map((item) => ({
    journey: String(item?.journey ?? ""),
    viewport: typeof item?.viewport === "string" ? item.viewport : "",
    head: classifyRun(item?.head, item?.plan),
    run: item?.head ?? null,
  }));
  if (!list.length) return { verdict: "FAIL", notes: "no journey was planned" };
  const red = new Set((Array.isArray(redFeatures) ? redFeatures : []).map(String));
  const problems = [];
  const notes = [];
  const unjudged = [];
  const unrun = [];
  const label = (item) => (item.viewport ? `${item.journey} [${item.viewport}]` : item.journey);
  for (const item of list) {
    const where = label(item);
    if (item.head.state === "unavailable") unrun.push(`${where}: the run did not finish`);
    else if (item.head.state === "unjudged") unjudged.push(where);
    else if (item.head.state === "ok") continue;
    else if (red.has(areaOf(item.journey))) notes.push(`${where} is already red on production, so the nightly live pass owns it`);
    else problems.push(`${where}: ${failureNote(item.run, item.head.failIndex)}`);
  }
  if (bugfix && !list.some((item) => item.journey === "change:repro")) {
    if (bugfixProved) notes.push("the bug fix has no user path, and repro-first shows a changed test failing on the old code");
    else if (bugfixUnevaluated) unrun.push(`the bug fix has no repro journey: ${bugfixUnevaluated}`.slice(0, 240));
    else problems.push("the bug fix has no repro journey");
  }
  const notesOut = [...new Set([...unrun, ...unjudged.map((journey) => `${journey}: the judge model did not answer`)])];
  const verdict = problems.length ? "FAIL" : notesOut.length ? "UNEVALUATED" : notes.length ? "PASS+NOTES" : "PASS";
  return { verdict, notes: [...problems, ...notesOut, ...notes].join(" ").replace(/\s+/g, " ").trim().slice(0, 480) };
}

function buildMarker({ run, attempt = 1, head, tree, base } = {}) {
  const values = { run: String(run ?? ""), attempt: String(attempt ?? ""), head: String(head ?? ""), tree: String(tree ?? ""), base: String(base ?? "") };
  if (!/^[0-9]+$/.test(values.run) || !/^[0-9]+$/.test(values.attempt)) throw new Error("run is not a run id");
  for (const key of ["head", "tree", "base"]) if (!HEX40.test(values[key])) throw new Error(`${key} is not a sha`);
  return `<!-- pstack-verifier run ${values.run} attempt ${values.attempt} head ${values.head} tree ${values.tree} base ${values.base} -->`;
}

function parseMarker(text) {
  const match = /<!--\s*pstack-verifier run (\d+) attempt (\d+) head ([0-9a-f]{40}) tree ([0-9a-f]{40}) base ([0-9a-f]{40})\s*-->/.exec(String(text ?? ""));
  if (!match) return null;
  return { run: match[1], attempt: match[2], head: match[3], tree: match[4], base: match[5] };
}

function isPass(verdict) {
  return PASS_VERDICTS.includes(String(verdict ?? "").trim().toUpperCase());
}

function reusableVerdict({ comments, artifact, status, current, logins, repo } = {}) {
  const allowed = new Set((Array.isArray(logins) ? logins : []).map((login) => String(login)));
  const marker = (Array.isArray(comments) ? comments : [])
    .map((comment) => ({ login: String(comment?.user?.login ?? ""), marker: parseMarker(comment?.body) }))
    .filter((item) => item.marker && allowed.has(item.login))
    .find((item) => artifact && item.marker.run === String(artifact.run) && item.marker.head === String(artifact.head));
  if (!marker) return { reuse: false, reason: "no matching marker" };
  if (!artifact || typeof artifact !== "object") return { reuse: false, reason: "the earlier verdict is unavailable" };
  if (!isPass(artifact.verdict)) return { reuse: false, reason: "the earlier verdict is not a pass" };
  if (!HEX40.test(String(current?.baseSha)) || !HEX40.test(String(current?.tree))) return { reuse: false, reason: "the current trees are unknown" };
  if (artifact.baseSha !== current.baseSha) return { reuse: false, reason: "the base differs" };
  if (artifact.tree !== current.tree) return { reuse: false, reason: "the head tree differs" };
  if (artifact.patchId !== current.patchId) return { reuse: false, reason: "the patch id differs" };
  if (artifact.diffSha256 !== current.diffSha256 || !HEX64.test(String(current.diffSha256))) return { reuse: false, reason: "the diff differs" };
  if (!status || status.state !== "success") return { reuse: false, reason: "the earlier status is not a success" };
  const target = String(status.target_url ?? "");
  if (!RUN_URL.test(target)) return { reuse: false, reason: "the earlier status has no run" };
  if (!target.includes(`/${repo}/actions/runs/${artifact.run}/attempts/${artifact.attempt}`)) return { reuse: false, reason: "the earlier status belongs to another run" };
  return { reuse: true, verdict: String(artifact.verdict).toUpperCase(), run: String(artifact.run), notes: `reused: same trees and base as run ${artifact.run}` };
}

function baseMoved({ item, plan } = {}) {
  if (!item || !plan) return { moved: false };
  if (String(item.head?.sha ?? "") !== String(plan.sha ?? "")) return { moved: true, part: "head" };
  if (String(item.base?.sha ?? "") !== String(plan.baseSha ?? "")) return { moved: true, part: "base" };
  return { moved: false };
}

function summaryMarkers({ comments, logins } = {}) {
  const allowed = new Set((Array.isArray(logins) ? logins : []).map((login) => String(login)));
  return (Array.isArray(comments) ? comments : [])
    .filter((comment) => allowed.has(String(comment?.user?.login ?? "")))
    .map((comment) => parseMarker(comment?.body))
    .filter(Boolean);
}

module.exports = {
  baseMoved,
  buildMarker,
  classifyRun,
  decideHeadOnly,
  isPass,
  parseMarker,
  reusableVerdict,
  sha256,
  summaryMarkers,
};
