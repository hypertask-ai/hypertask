import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { errorQuery, isReleaseWatchSpike, parseAddedDefinitions, releaseGroups, runReleaseWatch, RELEASE_WATCH } from "./flag-release-watch.mjs";

const now = Date.parse("2026-10-20T12:00:00Z");
const policy = { key: "htpr-7389-flag-release-policy", mode: "OWNER_AND_QA", releasedAt: null };
const flag = (key = "htpr-123-feature", minutes = 40, extra = {}) => ({ key, mode: "EVERYONE", releasedAt: new Date(now - minutes * 60_000).toISOString(), ...extra });
function fake(flags, counts = [4, 12]) {
  const calls = [];
  return {
    calls,
    options: {
      now, token: "agent-token", apiKey: "posthog-key", additions: new Map(),
      fetchImpl: async (url, init) => {
        calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
        assert.ok(init.signal);
        if (url.includes("posthog.com")) {
          assert.equal(init.headers.Authorization, "Bearer posthog-key");
          assert.equal(init.body && JSON.parse(init.body).query.kind, "HogQLQuery");
          return Response.json({ results: [counts] });
        }
        assert.equal(init.headers.Authorization, "Bearer agent-token");
        return Response.json(init.method === "PATCH" ? { flag: { mode: "OFF" } } : { flags: [policy, ...flags] });
      },
    },
  };
}

test("no candidates means no PostHog request", async () => {
  const { calls, options } = fake([]);
  assert.deepEqual(await runReleaseWatch(options), []);
  assert.equal(calls.length, 1);
});

test("a spike switches every flag in the release window Off with own ticket links", async () => {
  const flags = [flag(), flag("htpr-456-other")];
  const { calls, options } = fake(flags);
  assert.deepEqual(await runReleaseWatch(options), flags.map(row => row.key));
  const queries = calls.filter(call => call.url.includes("posthog.com"));
  assert.equal(queries.length, 1);
  const patches = calls.filter(call => call.method === "PATCH");
  assert.deepEqual(patches.map(call => call.body), flags.map((row, index) => ({ key: row.key, mode: "OFF", reason: `https://app.hypertask.ai/detail/project-15/${index ? 456 : 123}`, watch: { before: 4, after: 12, windowMinutes: 40 } })));
});

for (const counts of [[0, 9], [5, 10], [10, 12], [0, 0]]) test(`no spike ${counts} means no PATCH`, async () => {
  const { calls, options } = fake([flag()], counts);
  assert.deepEqual(await runReleaseWatch(options), []);
  assert.equal(calls.filter(call => call.method === "PATCH").length, 0);
  assert.equal(calls.length, 2);
});

test("policy Off does nothing, including no git discovery", async () => {
  const { calls, options } = fake([flag()]);
  options.additions = () => { throw new Error("discovery must not run"); };
  options.fetchImpl = async (url, init) => { calls.push({ url, ...init }); return Response.json({ flags: [{ ...policy, mode: "OFF" }, flag()] }); };
  assert.deepEqual(await runReleaseWatch(options), []);
  assert.equal(calls.length, 1);
});

for (const age of [10, 70, -1]) test(`release ${age} minutes ago is skipped`, async () => {
  const { calls, options } = fake([flag(undefined, age)]);
  assert.deepEqual(await runReleaseWatch(options), []);
  assert.equal(calls.length, 1);
});

test("production additions supply release dates only for null-release Everyone flags", async () => {
  const release = new Date(now - 35 * 60_000).toISOString();
  const definitions = parseAddedDefinitions(`${Date.parse(release) / 1000}\n\nsrc/lib/flags/definitions/htpr-123-feature.ts\nsrc/lib/flags/definitions/index.generated.ts\nsrc/lib/flags/definitions/htpr-456-other.ts\n`);
  assert.deepEqual([...definitions.keys()], ["htpr-123-feature", "htpr-456-other"]);
  const { calls, options } = fake([flag(undefined, 40, { releasedAt: null }), flag("htpr-456-other", 40, { mode: "OFF", releasedAt: null })]);
  options.additions = definitions;
  assert.deepEqual(await runReleaseWatch(options), ["htpr-123-feature"]);
  assert.equal(calls.at(-1).body.watch.windowMinutes, 35);
  assert.equal(releaseGroups([flag(undefined, 70)], definitions, now).size, 0);
});

test("before and after windows have equal duration, only production exceptions count", () => {
  const release = now - 40.5 * 60_000;
  const query = errorQuery(release, now);
  const times = [...query.matchAll(/toDateTime\('([^']+)'\)/g)].map(match => Date.parse(match[1]));
  assert.equal(release - times[2], times[3] - release);
  assert.equal(times[0], release);
  assert.match(query, /event = '\$exception'/);
  assert.match(query, /ht_environment = 'production'/);
  assert.match(query, /https:\/\/app.hypertask.ai\/%/);
});

test("separate releases are queried separately; 30 and 60 minute boundaries are watched", async () => {
  const { calls, options } = fake([flag(undefined, 30), flag("htpr-456-other", 60)]);
  assert.equal((await runReleaseWatch(options)).length, 2);
  assert.equal(calls.filter(call => call.url.includes("posthog.com")).length, 2);
});

test("server and script use the same spike rule and boundaries", () => {
  const server = readFileSync(new URL("../../src/app/api/mcp/flags/route.ts", import.meta.url), "utf8");
  assert.match(server, /import \{ RELEASE_WATCH, isReleaseWatchSpike \} from "@\/lib\/flags\/releaseWatch.mjs"/);
  assert.equal(RELEASE_WATCH.minimumErrors, 10);
  assert.equal(RELEASE_WATCH.multiplier, 2);
  assert.equal(isReleaseWatchSpike(4, 10), true);
  assert.equal(isReleaseWatchSpike(5, 10), false);
  assert.equal(isReleaseWatchSpike(-1, 10), false);
});

for (const counts of [[-1, 12], [0, "12"], [1, 10.5]]) test(`invalid PostHog counts fail closed: ${counts}`, async () => {
  const { calls, options } = fake([flag()], counts);
  await assert.rejects(runReleaseWatch(options), /counts are invalid/);
  assert.equal(calls.some(call => call.method === "PATCH"), false);
});

test("API failures propagate rather than reporting success", async () => {
  const { options } = fake([]);
  options.fetchImpl = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(runReleaseWatch(options), /HTTP 503/);
});

test("workflow is production-only, serialized, bounded and uses the existing secrets", () => {
  const workflow = readFileSync(new URL("../workflows/flag-release-watch.yml", import.meta.url), "utf8");
  for (const part of ['cron: "*/10 * * * *"', "workflow_dispatch:", "contents: read", "group: flag-release-watch", "cancel-in-progress: false", "timeout-minutes: 5", "fetch-depth: 0", "github.ref == 'refs/heads/production'", "secrets.HYPERTASK_MCP_TOKEN", "secrets.POSTHOG_FULL_API_KEY", "node .github/scripts/flag-release-watch.mjs"]) assert.ok(workflow.includes(part), part);
});

test("the policy flag is switched Off last so its batch can finish", async () => {
  const { calls, options } = fake([]);
  const fetchImpl = options.fetchImpl;
  options.fetchImpl = async (url, init) => {
    if (!init.method) return Response.json({ flags: [flag(policy.key, 50), flag("htpr-123-feature", 50), flag("htpr-456-other", 40)] });
    return fetchImpl(url, init);
  };
  assert.deepEqual(await runReleaseWatch(options), ["htpr-456-other", "htpr-123-feature", policy.key]);
  assert.equal(calls.at(-1).body.key, policy.key);
});
