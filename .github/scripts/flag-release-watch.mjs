import { pathToFileURL } from "node:url";
import { RELEASE_WATCH, isReleaseWatchSpike } from "../../src/lib/flags/releaseWatch.mjs";

export { RELEASE_WATCH, isReleaseWatchSpike };
const APP = "https://app.hypertask.ai";
export function releaseGroups(flags, now) {
  const groups = new Map();
  for (const flag of flags) {
    if (flag.mode !== "EVERYONE" || !/^htpr-[1-9]\d*-/.test(flag.key)) continue;
    if (!flag.releasedAt) continue;
    const release = flag.releasedAt;
    const time = new Date(release).getTime();
    const elapsed = (now - time) / 60_000;
    if (!Number.isFinite(elapsed) || elapsed < RELEASE_WATCH.minimumMinutes || elapsed > RELEASE_WATCH.watchMinutes) continue;
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push(flag.key);
  }
  return groups;
}

export function errorQuery(release, now) {
  const start = new Date(2 * release - now).toISOString();
  const split = new Date(release).toISOString();
  const end = new Date(now).toISOString();
  return `SELECT countIf(timestamp < toDateTime('${split}')), countIf(timestamp >= toDateTime('${split}')) FROM events WHERE event = '$exception' AND timestamp >= toDateTime('${start}') AND timestamp < toDateTime('${end}') AND (properties.ht_environment = 'production' OR (properties.ht_environment IS NULL AND properties.$current_url LIKE 'https://app.hypertask.ai/%'))`;
}

async function json(fetchImpl, url, options) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Release watch request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || body.success === false) throw new Error("Release watch API rejected the request");
  return body;
}

export async function runReleaseWatch({ fetchImpl = fetch, token = process.env.HYPERTASK_MCP_TOKEN, apiKey = process.env.POSTHOG_FULL_API_KEY, now = Date.now() } = {}) {
  if (!token || !apiKey) throw new Error("Release watch credentials are missing");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const { flags } = await json(fetchImpl, `${APP}/api/mcp/flags`, { method: "POST", headers });
  if (!Array.isArray(flags)) throw new Error("Release watch flag list is missing");
  const groups = releaseGroups(flags, now);
  const switched = [];
  const failures = [];
  for (const [release, keys] of groups) {
    const stats = await json(fetchImpl, "https://eu.posthog.com/api/projects/236160/query/", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: errorQuery(release, now) }, refresh: "force_blocking" }),
    });
    if (!Array.isArray(stats.results) || stats.results.length !== 1 || stats.hasMore) throw new Error("Release watch error counts are missing or truncated");
    const [before, after] = stats.results[0];
    if (![before, after].every((count) => Number.isSafeInteger(count) && count >= 0)) throw new Error("Release watch error counts are invalid");
    if (!isReleaseWatchSpike(before, after)) continue;
    for (const key of keys) {
      const ticket = /^htpr-([1-9]\d*)-/.exec(key)[1];
      try {
        const result = await json(fetchImpl, `${APP}/api/mcp/flags`, {
          method: "PATCH", headers,
          body: JSON.stringify({ key, mode: "OFF", reason: `${APP}/detail/project-15/${ticket}`, watch: { before, after, windowMinutes: Math.floor((now - release) / 60_000), releasedAt: new Date(release).toISOString() } }),
        });
        if (result.notified === false) throw new Error("Switched Off but ticket notification failed; manual follow-up required");
        switched.push(key);
        console.log(`[release-watch] ${key}: switched Off and notified Valentin`);
      } catch (error) {
        console.error(`[release-watch] ${key}: ${error.message}`);
        failures.push(new Error(`${key}: ${error.message}`, { cause: error }));
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, `Release watch failed for ${failures.length} flag(s)`);
  return switched;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReleaseWatch().then((keys) => console.log(`Release watch switched ${keys.length} flags Off`)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
