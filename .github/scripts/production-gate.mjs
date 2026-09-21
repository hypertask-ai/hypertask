import { pathToFileURL } from "node:url";

const API = "https://api.github.com";
const PROD_HEALTH_PATH = ".github/workflows/prod-health.yml";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

async function getJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return response.json();
}

export async function productionGate({ repository, token, mergeFreeze = "", fetchImpl = fetch }) {
  if (!repository || !token) throw new Error("repository and token are required");

  const production = await getJson(
    fetchImpl,
    `${API}/repos/${repository}/commits/production`,
    token,
  );
  if (!SHA_PATTERN.test(production?.sha ?? "")) {
    throw new Error("production HEAD could not be resolved");
  }

  const workflows = await getJson(
    fetchImpl,
    `${API}/repos/${repository}/actions/workflows?per_page=100`,
    token,
  );
  const workflow = (workflows?.workflows ?? []).find(
    (candidate) => candidate?.path === PROD_HEALTH_PATH,
  );
  if (!workflow?.id) throw new Error("prod-health.yml workflow could not be resolved");

  const runs = await getJson(
    fetchImpl,
    `${API}/repos/${repository}/actions/workflows/${workflow.id}/runs` +
      `?head_sha=${production.sha}&status=completed&per_page=1`,
    token,
  );
  const run = runs?.workflow_runs?.[0];
  let smokeFailed = false;
  if (run?.id) {
    const jobs = await getJson(
      fetchImpl,
      `${API}/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
      token,
    );
    smokeFailed = (jobs?.jobs ?? []).some(
      (job) => job?.name === "smoke" && job?.conclusion === "failure",
    );
  }

  const reasons = [];
  if (mergeFreeze !== "") reasons.push("MERGE_FREEZE is set");
  if (smokeFailed) reasons.push("production smoke failed");
  return { blocked: reasons.length > 0, reason: reasons.join("; ") };
}

async function main() {
  const result = await productionGate({
    repository: process.env.REPO ?? "",
    token: process.env.GH_TOKEN ?? "",
    mergeFreeze: process.env.MERGE_FREEZE ?? "",
  });
  if (result.blocked) process.stdout.write(result.reason);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
