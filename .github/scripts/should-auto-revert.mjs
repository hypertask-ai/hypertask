const API = "https://api.github.com";
const WORKFLOW = "ci-tests.yml";
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

function newestExactRun(runs, previousSha, branch) {
  return runs
    .filter(
      (run) =>
        run?.event === "push" &&
        run?.head_branch === branch &&
        run?.head_sha === previousSha &&
        run?.status === "completed",
    )
    .sort(
      (a, b) =>
        (b.id ?? 0) - (a.id ?? 0) ||
        (b.run_attempt ?? 0) - (a.run_attempt ?? 0),
    )[0];
}

export async function shouldAutoRevert(
  repository,
  previousSha,
  token,
  fetchImpl = fetch,
  delayImpl = delay,
  branch = "production",
) {
  if (!repository || !SHA_PATTERN.test(previousSha) || !token) {
    return { action: "skip", reason: "previous production CI could not be identified safely" };
  }

  const runsUrl =
    `${API}/repos/${repository}/actions/workflows/${WORKFLOW}/runs` +
    `?branch=${encodeURIComponent(branch)}&event=push&head_sha=${previousSha}` +
    `&status=completed&per_page=10`;
  let lastReason = "no completed workflow run found";

  for (let attempt = 1; attempt <= MAX_LOOKUP_ATTEMPTS; attempt += 1) {
    const runsResult = await getJson(fetchImpl, runsUrl, token);
    if (!runsResult.ok) {
      lastReason = `workflow lookup failed: ${runsResult.reason}`;
    } else {
      const run = newestExactRun(runsResult.data?.workflow_runs ?? [], previousSha, branch);
      if (run?.id) {
        const jobsResult = await getJson(
          fetchImpl,
          `${API}/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
          token,
        );
        if (!jobsResult.ok) {
          lastReason = `job lookup failed: ${jobsResult.reason}`;
        } else {
          const job = (jobsResult.data?.jobs ?? []).find((candidate) => candidate?.name === "ci-tests");
          if (job?.conclusion === "success") {
            return { action: "proceed", reason: `previous production ci-tests passed in run ${run.id}` };
          }
          if (job?.conclusion) {
            return {
              action: "skip",
              reason: `previous production ci-tests did not pass (${job.conclusion}) in run ${run.id}`,
            };
          }
          lastReason = `ci-tests result missing from completed run ${run.id}`;
        }
      }
    }

    if (attempt < MAX_LOOKUP_ATTEMPTS) await delayImpl(LOOKUP_INTERVAL_MS);
  }

  return { action: "skip", reason: `${lastReason} after ${MAX_LOOKUP_ATTEMPTS} attempts` };
}

async function main() {
  const [repository, previousSha] = process.argv.slice(2);
  const result = await shouldAutoRevert(
    repository,
    previousSha,
    process.env.GH_TOKEN || "",
  );
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
