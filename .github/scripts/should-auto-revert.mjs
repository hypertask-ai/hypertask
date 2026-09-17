const API = "https://api.github.com";
const HEALTH_CONTEXT = "prod-health-gate";
const MAX_LOOKUP_ATTEMPTS = 3;
const LOOKUP_INTERVAL_MS = 10_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(fetchImpl, url, token) {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok || response.status < 200 || response.status >= 300) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function healthGateState(payload) {
  const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
  const gate = statuses.find((status) => status?.context === HEALTH_CONTEXT);
  return gate?.state ?? "";
}

export async function shouldAutoRevert(
  repository,
  currentSha,
  token,
  fetchImpl = fetch,
  delayImpl = delay,
) {
  if (!repository || !SHA_PATTERN.test(currentSha) || !token) {
    return {
      action: "skip",
      reason: "this deploy's live-site health check could not be identified safely",
    };
  }

  const statusUrl =
    `${API}/repos/${repository}/commits/${currentSha}/status?per_page=100`;
  let lastReason = "live-site health check has not finished for this deploy";

  for (let attempt = 1; attempt <= MAX_LOOKUP_ATTEMPTS; attempt += 1) {
    const statusResult = await getJson(fetchImpl, statusUrl, token);
    if (!statusResult.ok) {
      lastReason = `live-site health lookup failed: ${statusResult.reason}`;
    } else {
      const state = healthGateState(statusResult.data);
      if (state === "failure") {
        return {
          action: "proceed",
          reason: "the live website failed its health check for this deploy",
        };
      }
      if (state === "success") {
        return {
          action: "skip",
          reason: "the live website is healthy; a unit-test failure is not a reason to revert",
        };
      }
      if (state === "pending") {
        lastReason = "live-site health check is still running for this deploy";
      } else {
        lastReason = "live-site health check has not finished for this deploy";
      }
    }

    if (attempt < MAX_LOOKUP_ATTEMPTS) await delayImpl(LOOKUP_INTERVAL_MS);
  }

  return { action: "skip", reason: `${lastReason} after ${MAX_LOOKUP_ATTEMPTS} attempts` };
}

async function main() {
  const [repository, currentSha] = process.argv.slice(2);
  const result = await shouldAutoRevert(
    repository,
    currentSha,
    process.env.GH_TOKEN || "",
  );
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
