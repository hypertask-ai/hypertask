// Emergency production rollback: freeze merging, restore production's git tree
// to the failing commit's parent, and optionally promote a previously healthy
// Vercel deployment while the revert deployment builds.
//
// Usage: node .github/scripts/emergency-rollback.mjs <failing-sha>
//        (reads VERCEL_TOKEN, GITHUB_TOKEN, and GITHUB_REPOSITORY from env)
// Prints one JSON object on stdout: {action: "requested"|"skip"|"failed", ...}

const PROJECT_SLUG = "hypertasks-prod";
const VERCEL_API = "https://api.vercel.com";
const GITHUB_API = "https://api.github.com";
const IN_FLIGHT_STATES = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);
const MAX_IN_FLIGHT_POLLS = 5;
const IN_FLIGHT_POLL_INTERVAL_MS = 30_000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(fetchImpl, url, token, options = {}) {
  try {
    const headers = { ...options.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(url, { ...options, headers });
    if (!res.ok || res.status < 200 || res.status >= 300) {
      return { ok: false, status: res.status, reason: "non-2xx response" };
    }
    if (res.status === 204) return { ok: true, data: undefined, status: res.status };
    try {
      return { ok: true, data: await res.json(), status: res.status };
    } catch (err) {
      return { ok: false, status: res.status, reason: err.message };
    }
  } catch (err) {
    return { ok: false, status: "unknown", reason: err.message };
  }
}

function githubOptions(method = "GET", body) {
  return {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

export async function setMergeFreeze(repository, runUrl, githubToken, fetchImpl = fetch) {
  if (!repository || !runUrl || !githubToken) return false;
  const variableUrl = `${GITHUB_API}/repos/${repository}/actions/variables/MERGE_FREEZE`;
  const updated = await requestJson(
    fetchImpl,
    variableUrl,
    githubToken,
    githubOptions("PATCH", { name: "MERGE_FREEZE", value: runUrl }),
  );
  if (updated.ok) return true;
  if (updated.status !== 404) return false;

  const created = await requestJson(
    fetchImpl,
    `${GITHUB_API}/repos/${repository}/actions/variables`,
    githubToken,
    githubOptions("POST", { name: "MERGE_FREEZE", value: runUrl }),
  );
  return created.ok;
}

async function compareProduction(fetchImpl, repository, githubToken, failingSha, headSha) {
  const commits = [];
  let page = 1;
  let status;
  let totalCommits;
  do {
    const result = await requestJson(
      fetchImpl,
      `${GITHUB_API}/repos/${repository}/compare/${failingSha}...${headSha}?per_page=100&page=${page}`,
      githubToken,
      githubOptions(),
    );
    if (!result.ok) return result;
    status ??= result.data?.status;
    totalCommits ??= result.data?.total_commits ?? 0;
    const pageCommits = result.data?.commits ?? [];
    commits.push(...pageCommits);
    if (pageCommits.length === 0) break;
    page += 1;
  } while (commits.length < totalCommits);
  return { ok: true, status, commits };
}

export async function createProductionRevert(
  failingSha,
  repository,
  githubToken,
  fetchImpl = fetch,
) {
  if (!/^[0-9a-f]{40}$/i.test(failingSha)) {
    return { action: "failed", reason: "failing SHA must be a full 40-character commit SHA" };
  }
  if (!repository || !githubToken) {
    return { action: "failed", reason: "GitHub repository or rollback token is not configured" };
  }

  const commitUrl = `${GITHUB_API}/repos/${repository}/git/commits`;
  const failingCommit = await requestJson(
    fetchImpl,
    `${commitUrl}/${failingSha}`,
    githubToken,
    githubOptions(),
  );
  const parentSha = failingCommit.data?.parents?.[0]?.sha;
  if (!failingCommit.ok || !parentSha) {
    return {
      action: "failed",
      reason: `could not resolve the failing commit's parent: HTTP ${failingCommit.status}`,
    };
  }
  const parentCommit = await requestJson(
    fetchImpl,
    `${commitUrl}/${parentSha}`,
    githubToken,
    githubOptions(),
  );
  const restoreTree = parentCommit.data?.tree?.sha;
  if (!parentCommit.ok || !restoreTree) {
    return {
      action: "failed",
      reason: `could not resolve the pre-failure tree: HTTP ${parentCommit.status}`,
    };
  }

  const message = `Revert ${failingSha.slice(0, 7)}: production smoke failed (auto-rollback)`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const ref = await requestJson(
      fetchImpl,
      `${GITHUB_API}/repos/${repository}/git/ref/heads/production`,
      githubToken,
      githubOptions(),
    );
    const headSha = ref.data?.object?.sha;
    if (!ref.ok || !headSha) {
      return { action: "failed", reason: `could not resolve production HEAD: HTTP ${ref.status}` };
    }

    const comparison = await compareProduction(
      fetchImpl,
      repository,
      githubToken,
      failingSha,
      headSha,
    );
    if (!comparison.ok) {
      return { action: "failed", reason: `could not compare production to the failing SHA: HTTP ${comparison.status}` };
    }
    const existing = comparison.commits.find(
      (commit) => commit?.commit?.message?.split("\n", 1)[0] === message,
    );
    if (existing) {
      return {
        action: "already_reverted",
        sha: existing.sha,
        revertedFrom: failingSha,
        revertedThrough: existing.sha,
      };
    }
    if (comparison.status !== "ahead" && comparison.status !== "identical") {
      return {
        action: "failed",
        reason: `failing commit is not an ancestor of production HEAD (${comparison.status || "unknown"})`,
      };
    }

    const created = await requestJson(
      fetchImpl,
      commitUrl,
      githubToken,
      githubOptions("POST", {
        message,
        tree: restoreTree,
        parents: [headSha],
      }),
    );
    const revertSha = created.data?.sha;
    if (!created.ok || !revertSha) {
      return { action: "failed", reason: `could not create the production revert commit: HTTP ${created.status}` };
    }

    const updated = await requestJson(
      fetchImpl,
      `${GITHUB_API}/repos/${repository}/git/refs/heads/production`,
      githubToken,
      githubOptions("PATCH", { sha: revertSha, force: false }),
    );
    if (updated.ok) {
      return {
        action: "created",
        sha: revertSha,
        revertedFrom: failingSha,
        revertedThrough: headSha,
      };
    }
    if (attempt === 2 || (updated.status !== 409 && updated.status !== 422)) {
      return { action: "failed", reason: `could not advance production to the revert: HTTP ${updated.status}` };
    }
  }
  return { action: "failed", reason: "production kept moving while the revert was created" };
}

async function hasGreenProdHealthRun(fetchImpl, repository, githubToken, sha) {
  if (!repository) return false;
  const result = await requestJson(
    fetchImpl,
    `${GITHUB_API}/repos/${repository}/actions/workflows/prod-health.yml/runs?head_sha=${sha}&event=push&per_page=10`,
    githubToken,
    githubOptions(),
  );
  if (!result.ok) return false;
  const latest = (result.data?.workflow_runs ?? [])
    .filter((run) => run.status === "completed")
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  return latest?.conclusion === "success";
}

async function recheckLiveProduction(fetchImpl, token, liveId, failingSha) {
  const recheckResult = await requestJson(fetchImpl, `${VERCEL_API}/v9/projects/${PROJECT_SLUG}`, token);
  if (!recheckResult.ok) {
    return { action: "failed", reason: `production recheck failed: HTTP ${recheckResult.status}` };
  }
  const recheck = recheckResult.data;
  const recheckId = recheck?.targets?.production?.id;
  const recheckSha = recheck?.targets?.production?.meta?.githubCommitSha;
  if (recheckSha !== failingSha) {
    return { action: "skip", reason: `production already moved past the failing commit ${failingSha}` };
  }
  if (!recheckId || recheckId !== liveId) {
    return { action: "skip", reason: "production moved during the check, no promotion attempted" };
  }
  return null;
}

export async function promotePreviousDeployment(
  failingSha,
  token,
  fetchImpl = fetch,
  delayImpl = delay,
  { repository = process.env.GITHUB_REPOSITORY || "", githubToken = "" } = {},
) {
  const projectResult = await requestJson(fetchImpl, `${VERCEL_API}/v9/projects/${PROJECT_SLUG}`, token);
  if (!projectResult.ok) {
    return { action: "failed", reason: `could not resolve the Vercel project: HTTP ${projectResult.status}` };
  }
  const project = projectResult.data;
  const projectId = project?.id;
  const live = project?.targets?.production;
  const liveId = live?.id;
  const liveSha = live?.meta?.githubCommitSha;
  const liveCreated = live?.createdAt;

  if (!projectId || !liveId || !liveCreated) {
    return { action: "failed", reason: "could not resolve the Vercel project or the live production deployment" };
  }
  if (!liveSha || liveSha !== failingSha) {
    return { action: "skip", reason: `production already moved on to a different commit (${liveSha || "unknown"}), no promotion attempted` };
  }

  const recheckFailure = await recheckLiveProduction(fetchImpl, token, liveId, failingSha);
  if (recheckFailure) return recheckFailure;

  const deploymentsUrl = `${VERCEL_API}/v6/deployments?projectId=${projectId}&target=production&limit=10`;
  let deploysResult = await requestJson(fetchImpl, deploymentsUrl, token);
  if (!deploysResult.ok) {
    return { action: "failed", reason: `deployment list failed: HTTP ${deploysResult.status}` };
  }
  let deployments = deploysResult.data?.deployments ?? [];
  let inFlight = deployments.find((deployment) => deployment?.uid && IN_FLIGHT_STATES.has(deployment?.state));
  let polls = 0;
  while (inFlight && polls < MAX_IN_FLIGHT_POLLS) {
    await delayImpl(IN_FLIGHT_POLL_INTERVAL_MS);
    polls += 1;
    deploysResult = await requestJson(fetchImpl, deploymentsUrl, token);
    if (!deploysResult.ok) {
      return { action: "failed", reason: `deployment list failed: HTTP ${deploysResult.status}` };
    }
    deployments = deploysResult.data?.deployments ?? [];
    inFlight = deployments.find((deployment) => deployment?.uid && IN_FLIGHT_STATES.has(deployment?.state));
  }

  if (polls > 0) {
    const afterWaitFailure = await recheckLiveProduction(fetchImpl, token, liveId, failingSha);
    if (afterWaitFailure) return afterWaitFailure;
  }
  const proceededDespiteInFlight = inFlight
    ? `promotion proceeded despite an in-flight production deployment (${inFlight.uid} ${inFlight.state})`
    : undefined;

  const candidates = deployments
    .filter(
      (deployment) =>
        deployment?.uid &&
        deployment.state === "READY" &&
        deployment.uid !== liveId &&
        deployment?.meta?.githubCommitSha &&
        deployment.meta.githubCommitSha !== failingSha &&
        (deployment.created ?? 0) < liveCreated,
    )
    .sort((a, b) => b.created - a.created);
  let candidate;
  for (const deployment of candidates) {
    if (await hasGreenProdHealthRun(fetchImpl, repository, githubToken, deployment.meta.githubCommitSha)) {
      candidate = deployment;
      break;
    }
  }
  if (!candidate) {
    return { action: "skip", reason: "no older READY deployment with a green prod-health run found to promote" };
  }

  const deploymentId = candidate.uid;
  const inspectorUrl = candidate.inspectorUrl || "https://vercel.com/dashboard";
  try {
    const res = await fetchImpl(`${VERCEL_API}/v10/projects/${projectId}/promote/${deploymentId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok || res.status < 200 || res.status >= 300) {
      return { action: "failed", reason: `promote request returned HTTP ${res.status}`, httpStatus: res.status };
    }
    const verificationResult = await requestJson(fetchImpl, `${VERCEL_API}/v9/projects/${PROJECT_SLUG}`, token);
    if (!verificationResult.ok) {
      return { action: "failed", reason: `post-promote verification failed: HTTP ${verificationResult.status}` };
    }
    const verificationId = verificationResult.data?.targets?.production?.id;
    if (verificationId !== deploymentId) {
      return { action: "failed", reason: `promotion did not take effect, production is now ${verificationId || "unknown"}` };
    }
    return {
      action: "requested",
      deploymentId,
      inspectorUrl,
      httpStatus: res.status,
      ...(proceededDespiteInFlight ? { reason: proceededDespiteInFlight } : {}),
    };
  } catch (err) {
    return { action: "failed", reason: `promote request never reached Vercel: ${err.message}` };
  }
}

export async function emergencyRollback(
  failingSha,
  token,
  fetchImpl = fetch,
  delayImpl = delay,
  {
    durable = false,
    repository = process.env.GITHUB_REPOSITORY || "",
    githubToken = process.env.GITHUB_TOKEN || "",
    runUrl = process.env.GITHUB_RUN_URL || "",
  } = {},
) {
  if (!durable) {
    const promotion = await promotePreviousDeployment(
      failingSha,
      token,
      fetchImpl,
      delayImpl,
      { repository, githubToken },
    );
    return { ...promotion, revert: { action: "not_requested" }, freeze: false };
  }

  const freeze = await setMergeFreeze(repository, runUrl, githubToken, fetchImpl);
  const revert = await createProductionRevert(failingSha, repository, githubToken, fetchImpl);
  if (revert.action === "already_reverted") {
    return {
      action: "skip",
      reason: `a revert of ${failingSha} already exists on production`,
      revert,
      freeze,
    };
  }

  const promotion = await promotePreviousDeployment(
    failingSha,
    token,
    fetchImpl,
    delayImpl,
    { repository, githubToken },
  );
  if (revert.action !== "created") {
    return {
      ...promotion,
      action: "failed",
      reason: `${revert.reason}; Vercel promotion ${promotion.action}: ${promotion.reason || promotion.deploymentId || "no details"}`,
      revert,
      freeze,
    };
  }
  if (promotion.action === "requested") {
    return { ...promotion, revert, freeze };
  }
  return {
    action: "requested",
    reason: `production revert created; Vercel promotion ${promotion.action}: ${promotion.reason || "no details"}`,
    revert,
    freeze,
  };
}

async function main() {
  const failingSha = process.argv[2];
  if (!failingSha) {
    console.error("Usage: emergency-rollback.mjs <failing-sha>");
    process.exit(1);
  }
  const repository = process.env.GITHUB_REPOSITORY || "";
  const runUrl = process.env.GITHUB_RUN_URL || (
    repository && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : ""
  );
  const result = await emergencyRollback(
    failingSha,
    process.env.VERCEL_TOKEN || "",
    fetch,
    delay,
    {
      durable: true,
      repository,
      githubToken: process.env.GITHUB_TOKEN || "",
      runUrl,
    },
  );
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
