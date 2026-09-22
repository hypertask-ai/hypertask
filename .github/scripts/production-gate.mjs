const marker = ".github/workflows/prod-health.yml";

export async function checkProductionGate({ repo, mergeFreeze, fetchImpl = fetch }) {
  async function get(path) {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/${path}`);
    if (!response.ok) throw new Error(`Production gate GitHub read failed for ${path}: HTTP ${response.status}`);
    try {
      const body = await response.json();
      if (!body || typeof body !== "object") throw new Error("Invalid JSON body");
      return body;
    } catch {
      throw new Error(`Production gate GitHub response is unreadable for ${path}`);
    }
  }

  const head = (await get("commits/production")).sha;
  if (!head) throw new Error("production HEAD SHA is unreadable");
  if (mergeFreeze) return `freeze|${head}|MERGE_FREEZE is set`;
  let workflow;
  for (let page = 1; !workflow; page += 1) {
    const { workflows } = await get(`actions/workflows?per_page=100&page=${page}`);
    if (!Array.isArray(workflows)) throw new Error("prod-health workflow list is unreadable");
    workflow = workflows.find(({ path }) => path === marker);
    if (!workflow && workflows.length < 100) throw new Error("prod-health workflow not found");
  }
  if (!workflow.id) throw new Error("prod-health workflow ID is unreadable");

  const { workflow_runs: runs } = await get(
    `actions/workflows/${workflow.id}/runs?head_sha=${head}&event=push&per_page=100`,
  );
  if (!Array.isArray(runs)) throw new Error("prod-health runs are unreadable");
  const run = runs.filter(({ head_sha, event }) => head_sha === head && event === "push")
    .sort((a, b) => b.id - a.id)[0];
  if (!run) return `pending|${head}|production ${head.slice(0, 9)} has no push prod-health run`;
  if (!run.id) throw new Error("prod-health run ID is unreadable");
  if (run.status !== "completed") return `pending|${head}|production ${head.slice(0, 9)} push prod-health run ${run.id} is ${run.status || "unreadable"}`;
  if (!run.conclusion || ["cancelled", "skipped"].includes(run.conclusion)) {
    return `pending|${head}|production ${head.slice(0, 9)} push prod-health run ${run.id} concluded ${run.conclusion || "unreadable"}`;
  }

  const { jobs } = await get(`actions/runs/${run.id}/jobs?per_page=100`);
  if (!Array.isArray(jobs)) throw new Error(`prod-health run ${run.id} jobs are unreadable`);
  const smoke = jobs.find(({ name }) => name === "smoke");
  if (!smoke || smoke.conclusion !== "success") {
    const kind = ["failure", "cancelled", "skipped"].includes(smoke?.conclusion) ? "smoke-failure" : "pending";
    return `${kind}|${head}|production ${head.slice(0, 9)} smoke ${smoke?.conclusion || "missing or unreadable"} (run ${run.id})`;
  }
  const step = smoke.steps?.find(({ name }) => name === "Run the smoke checks");
  if (step?.status !== "completed" || step.conclusion !== "success") {
    const kind = ["failure", "cancelled", "skipped"].includes(step?.conclusion) ? "smoke-failure" : "pending";
    return `${kind}|${head}|production ${head.slice(0, 9)} smoke step ${step?.conclusion || "missing or unreadable"} (run ${run.id})`;
  }
  return null;
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
