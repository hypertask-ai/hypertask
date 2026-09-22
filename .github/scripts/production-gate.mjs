const marker = ".github/workflows/prod-health.yml";

export async function checkProductionGate({ repo, mergeFreeze, fetchImpl = fetch }) {
  if (mergeFreeze) return "MERGE_FREEZE is set";

  async function get(path) {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/${path}`);
    if (!response.ok) throw new Error(`Production gate GitHub read failed: ${response.status}`);
    return response.json();
  }

  const head = (await get("commits/production")).sha;
  let workflow;
  for (let page = 1; !workflow; page += 1) {
    const { workflows } = await get(`actions/workflows?per_page=100&page=${page}`);
    workflow = workflows.find(({ path }) => path === marker);
    if (!workflow && workflows.length < 100) throw new Error("prod-health workflow not found");
  }

  const { workflow_runs: runs } = await get(
    `actions/workflows/${workflow.id}/runs?head_sha=${head}&status=completed&per_page=100`,
  );
  const run = runs.find(({ head_sha, status }) => head_sha === head && status === "completed");
  if (!run) return null;

  const { jobs } = await get(`actions/runs/${run.id}/jobs?per_page=100`);
  return jobs.some(({ name, conclusion }) => name === "smoke" && conclusion === "failure")
    ? `production ${head.slice(0, 9)} smoke failed (run ${run.id})`
    : null;
}

if (process.argv[1]?.endsWith("production-gate.mjs")) {
  const token = process.env.GH_TOKEN;
  checkProductionGate({
    repo: process.env.REPO,
    mergeFreeze: process.env.MERGE_FREEZE,
    fetchImpl: (url) => fetch(url, { headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    } }),
  }).then((reason) => {
    if (reason) console.log(reason);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
