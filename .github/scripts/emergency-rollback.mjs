// A confirmed production smoke failure freezes merges and restores the tree
// from immediately before the failing SHA in one GitHub commit. Vercel promotion
// is only an optional speed-up when the old deployment passed smoke.
// Usage: node .github/scripts/emergency-rollback.mjs <failing-sha>

const PROJECT_SLUG = "hypertasks-prod";
const API = "https://api.vercel.com";
const IN_FLIGHT_STATES = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);
const MAX_IN_FLIGHT_POLLS = 5;
const IN_FLIGHT_POLL_INTERVAL_MS = 30_000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(fetchImpl, url, token) {
  try {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok || res.status < 200 || res.status >= 300) {
      return { ok: false, status: res.status, reason: "non-2xx response" };
    }
    try {
      return { ok: true, data: await res.json() };
    } catch (err) {
      return { ok: false, status: res.status, reason: err.message };
    }
  } catch (err) {
    return { ok: false, status: "unknown", reason: err.message };
  }
}

async function recheckLiveProduction(fetchImpl, token, liveId, failingSha) {
  const recheckResult = await getJson(fetchImpl, `${API}/v9/projects/${PROJECT_SLUG}`, token);
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

const GITHUB_API = "https://api.github.com";

async function github(fetchImpl, repo, token, path, method = "GET", body) {
  const result = await getJsonRequest(fetchImpl, `${GITHUB_API}/repos/${repo}${path}`, token, method, body);
  if (!result.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${result.status}`);
  return result.data;
}

async function getJsonRequest(fetchImpl, url, token, method = "GET", body) {
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: res.status === 204 ? null : await res.json() };
  } catch (err) {
    return { ok: false, status: err.message };
  }
}

async function freezeMerges(fetchImpl, repo, token, runUrl) {
  const path = "/actions/variables/MERGE_FREEZE";
  const updated = await getJsonRequest(fetchImpl, `${GITHUB_API}/repos/${repo}${path}`, token, "PATCH", { name: "MERGE_FREEZE", value: runUrl });
  if (updated.ok) return;
  if (updated.status !== 404) throw new Error(`MERGE_FREEZE update: HTTP ${updated.status}`);
  const created = await getJsonRequest(fetchImpl, `${GITHUB_API}/repos/${repo}/actions/variables`, token, "POST", { name: "MERGE_FREEZE", value: runUrl });
  if (!created.ok) throw new Error(`MERGE_FREEZE create: HTTP ${created.status}`);
}

async function revertProduction(failingSha, fetchImpl, repo, token) {
  const refPath = "/git/ref/heads/production";
  const head = (await github(fetchImpl, repo, token, refPath)).object.sha;
  const failing = await github(fetchImpl, repo, token, `/git/commits/${failingSha}`);
  const parent = failing.parents?.[0]?.sha;
  if (!parent) throw new Error("failing commit has no parent");

  // Only a prior rollback of this SHA on production is an idempotent skip.
  // Walk the first-parent chain, not a compare page (which can truncate at 250).
  let cursor = head;
  while (cursor !== failingSha) {
    const commit = await github(fetchImpl, repo, token, `/git/commits/${cursor}`);
    if (commit.message?.startsWith(`Revert ${failingSha.slice(0, 7)}: production smoke failed (auto-rollback)`)) {
      return { status: "already-reverted", sha: cursor };
    }
    cursor = commit.parents?.[0]?.sha;
    if (!cursor) throw new Error("failing SHA is not on production's first-parent history");
  }

  // Git trees snapshot the entire state; parenting that snapshot to the
  // current HEAD reverts X..HEAD atomically, including merges and deletions.
  const previous = await github(fetchImpl, repo, token, `/git/commits/${parent}`);
  const message = `Revert ${failingSha.slice(0, 7)}: production smoke failed (auto-rollback)`;
  const commit = await github(fetchImpl, repo, token, "/git/commits", "POST", {
    message, tree: previous.tree.sha, parents: [head],
  });
  // A non-force ref update fails closed if another merge landed in the meantime.
  await github(fetchImpl, repo, token, refPath, "PATCH", { sha: commit.sha, force: false });
  return { status: "created", sha: commit.sha, revertedThrough: head };
}

async function passedSmoke(fetchImpl, repo, token, sha) {
  try {
    const runs = await github(fetchImpl, repo, token, `/actions/workflows/prod-health.yml/runs?head_sha=${sha}&event=push&per_page=20`);
    for (const run of runs.workflow_runs ?? []) {
      if (run.head_sha !== sha || run.status !== "completed" || run.conclusion !== "success") continue;
      const jobs = await github(fetchImpl, repo, token, `/actions/runs/${run.id}/jobs?per_page=100`);
      if (jobs.jobs?.some((job) => job.name === "smoke" && job.conclusion === "success")) return true;
    }
  } catch {
    // GitHub unavailable: no proof means no promotion.
  }
  return false;
}

export async function emergencyRollback(failingSha, token, fetchImpl = fetch, delayImpl = delay, options = {}) {
  const repo = options.repo ?? process.env.GITHUB_REPOSITORY;
  const githubToken = options.githubToken ?? process.env.ROLLBACK_GITHUB_TOKEN;
  const runUrl = options.runUrl ?? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  let frozen = false;
  try {
    if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") return { action: "skip", reason: "manual runs never roll back", revert: { status: "skipped" }, freeze: false };
    if (!repo || !githubToken || !/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(runUrl)) {
      throw new Error("missing GitHub repository, rollback token or run URL");
    }
    await freezeMerges(fetchImpl, repo, githubToken, runUrl);
    frozen = true;
    const revert = await revertProduction(failingSha, fetchImpl, repo, githubToken);
    if (revert.status === "already-reverted") return { action: "skip", revert, freeze: true, reason: "failing SHA already reverted" };
    const promotion = await promoteVerifiedDeployment(failingSha, token, fetchImpl, delayImpl, repo, githubToken);
    return { ...promotion, action: "requested", revert, freeze: true };
  } catch (err) {
    return { action: "failed", reason: err.message, revert: { status: "failed" }, freeze: frozen };
  }
}

async function promoteVerifiedDeployment(failingSha, token, fetchImpl, delayImpl, repo, githubToken) {
  if (!token) return { reason: "no Vercel token; revert will deploy normally" };

  // v9/projects returns both the project id and targets.production (the
  // deployment Vercel is actually serving live) in one call — the newest
  // entry from a deployments list is only a guess at "live".
  const projectResult = await getJson(fetchImpl, `${API}/v9/projects/${PROJECT_SLUG}`, token);
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

  // Re-read live production before the final deployment-list guard. These
  // reads and the POST are separate calls, not a transaction, so the checks
  // narrow (never close) the window where something else changed what's live.
  const recheckFailure = await recheckLiveProduction(fetchImpl, token, liveId, failingSha);
  if (recheckFailure) return recheckFailure;

  // Use the all-state production list to select the previous READY deployment.
  // If another deployment is in flight, give it a bounded chance to finish.
  const deploymentsUrl = `${API}/v6/deployments?projectId=${projectId}&target=production&limit=10`;
  let deploysResult = await getJson(
    fetchImpl,
    deploymentsUrl,
    token,
  );
  if (!deploysResult.ok) {
    return { action: "failed", reason: `deployment list failed: HTTP ${deploysResult.status}` };
  }
  let deployments = deploysResult.data?.deployments ?? [];
  let inFlight = deployments.find((d) => d?.uid && IN_FLIGHT_STATES.has(d?.state));
  let polls = 0;
  while (inFlight && polls < MAX_IN_FLIGHT_POLLS) {
    await delayImpl(IN_FLIGHT_POLL_INTERVAL_MS);
    polls += 1;
    deploysResult = await getJson(fetchImpl, deploymentsUrl, token);
    if (!deploysResult.ok) {
      return { action: "failed", reason: `deployment list failed: HTTP ${deploysResult.status}` };
    }
    deployments = deploysResult.data?.deployments ?? [];
    inFlight = deployments.find((d) => d?.uid && IN_FLIGHT_STATES.has(d?.state));
  }

  // Waiting widens the race window, so repeat both live-production guards
  // before selecting a candidate or issuing the promotion request.
  if (polls > 0) {
    const afterWaitFailure = await recheckLiveProduction(fetchImpl, token, liveId, failingSha);
    if (afterWaitFailure) return afterWaitFailure;
  }
  const proceededDespiteInFlight = inFlight
    ? `promotion proceeded despite an in-flight production deployment (${inFlight.uid} ${inFlight.state})`
    : undefined;

  // Belt and braces: a candidate must differ from the live deployment by
  // BOTH id and sha, so a second deploy of the same failing commit can never
  // be picked as "the previous good one".
  const candidates = deployments
    .filter(
      (d) =>
        d?.uid &&
        d.state === "READY" &&
        d.uid !== liveId &&
        d?.meta?.githubCommitSha &&
        d.meta.githubCommitSha !== failingSha &&
        (d.created ?? 0) < liveCreated,
    )
    .sort((a, b) => b.created - a.created);
  let candidate;
  for (const deployment of candidates) {
    if (await passedSmoke(fetchImpl, repo, githubToken, deployment.meta.githubCommitSha)) {
      candidate = deployment;
      break;
    }
  }

  if (!candidate) {
    return { action: "skip", reason: "no older READY deployment with a green prod-health smoke run" };
  }

  // From here on, the live deployment is provably still `liveId` at the
  // failing commit this rollback was invoked for.
  const deploymentId = candidate.uid;
  const inspectorUrl = candidate.inspectorUrl || "https://vercel.com/dashboard";
  try {
    const res = await fetchImpl(`${API}/v10/projects/${projectId}/promote/${deploymentId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok || res.status < 200 || res.status >= 300) {
      return { action: "failed", reason: `promote request returned HTTP ${res.status}`, httpStatus: res.status };
    }
    const verificationResult = await getJson(fetchImpl, `${API}/v9/projects/${PROJECT_SLUG}`, token);
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

async function main() {
  const failingSha = process.argv[2];
  if (!failingSha) {
    console.error("Usage: emergency-rollback.mjs <failing-sha>");
    process.exit(1);
  }
  const result = await emergencyRollback(failingSha, process.env.VERCEL_TOKEN || "");
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
