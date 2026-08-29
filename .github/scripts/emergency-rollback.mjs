// Instant Vercel rollback for the staging auto-revert job (HTPR-5557): when
// git can't undo a failing commit (dirty revert or a refused push), this
// requests an instant promote of the last good production deployment instead
// of leaving production on a red build until a human fixes the git state.
//
// Design: request, verify once, and alert. After a successful promote request,
// this re-reads the production target once to confirm that the candidate is
// live, while still telling a human to verify production themselves. These
// API calls are not a transaction, so the pre- and post-promote checks narrow
// the race windows without closing them.
//
// Control flow is linear early-returns, one disqualifying condition per
// return. An in-flight deployment is the one exception: wait briefly for it,
// then promote anyway if it is stuck so it cannot block an emergency rollback.
//
// Usage: node .github/scripts/emergency-rollback.mjs <failing-sha>
//        (reads VERCEL_TOKEN from env)
// Prints one JSON object on stdout: {action: "requested"|"skip"|"failed", ...}

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

export async function emergencyRollback(failingSha, token, fetchImpl = fetch, delayImpl = delay) {
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
  const candidate = deployments
    .filter(
      (d) =>
        d?.uid &&
        d.state === "READY" &&
        d.uid !== liveId &&
        d?.meta?.githubCommitSha &&
        d.meta.githubCommitSha !== failingSha &&
        (d.created ?? 0) < liveCreated,
    )
    .sort((a, b) => b.created - a.created)[0];

  if (!candidate) {
    return { action: "skip", reason: "no qualifying older READY deployment found to promote" };
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
