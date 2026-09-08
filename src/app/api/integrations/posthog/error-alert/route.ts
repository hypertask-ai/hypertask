import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { Webhook } from "svix";

import {
  FEATURE_FLAG_OWNER_USER_ID,
  isFeatureEnabled,
  POSTHOG_ERROR_ALERT_FLAG,
} from "@/lib/flags";
import { getRedis } from "@/lib/redis";
import {
  claimPostHogAlert,
  commitPostHogAlertClaim,
  parsePostHogExceptionAlert,
  releasePostHogAlertClaim,
} from "@/lib/telemetry/posthogErrorAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function verifyWebhook(rawBody: string, request: NextRequest) {
  return new Webhook(requiredEnv("POSTHOG_ERROR_WEBHOOK_SECRET")).verify(
    rawBody,
    {
      "webhook-id": request.headers.get("webhook-id") || "",
      "webhook-timestamp": request.headers.get("webhook-timestamp") || "",
      "webhook-signature": request.headers.get("webhook-signature") || "",
    },
  );
}

function workflowRef() {
  // Pinned rather than read from the deployment's own VERCEL_GIT_COMMIT_REF:
  // whichever deployment happens to receive the PostHog webhook dispatches
  // the rollback workflow, and workflow_dispatch runs the workflow file as
  // it exists on the given ref. An ambient, request-time ref would let a
  // misrouted webhook (or a preview deployment processing it) execute
  // whatever workflow file lives on an untrusted branch, with production
  // secrets. A fixed, operator-controlled ref removes that dependency.
  const ref = process.env.POSTHOG_ROLLBACK_GITHUB_REF || "production";
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref)) {
    throw new Error("POSTHOG_ROLLBACK_GITHUB_REF is invalid");
  }
  return ref;
}

function signWorkflowPayload(
  payload: Record<string, unknown>,
  secret: string,
) {
  const canonical = JSON.stringify(
    Object.entries(payload).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function dispatchConfiguration() {
  const projectId = requiredEnv("POSTHOG_SERVER_PROJECT_ID");
  if (!/^\d{1,12}$/.test(projectId)) {
    throw new Error("POSTHOG_SERVER_PROJECT_ID is invalid");
  }
  const uiHost = new URL(
    process.env.POSTHOG_UI_HOST || "https://us.posthog.com",
  );
  if (
    uiHost.protocol !== "https:" ||
    !["eu.posthog.com", "us.posthog.com"].includes(uiHost.hostname)
  ) {
    throw new Error("POSTHOG_UI_HOST is invalid");
  }
  const repositoryOwner = requiredEnv("VERCEL_GIT_REPO_OWNER");
  const repositoryName = requiredEnv("VERCEL_GIT_REPO_SLUG");
  const workflow =
    process.env.POSTHOG_ROLLBACK_GITHUB_WORKFLOW || "prod-health.yml";
  if (
    !/^[A-Za-z0-9_.-]{1,100}$/.test(repositoryOwner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(repositoryName) ||
    !/^[A-Za-z0-9_.-]{1,100}\.ya?ml$/.test(workflow)
  ) {
    throw new Error("GitHub rollback workflow configuration is invalid");
  }
  return {
    githubToken: requiredEnv("POSTHOG_ROLLBACK_GITHUB_TOKEN"),
    githubWorkflowUrl: `https://api.github.com/repos/${repositoryOwner}/${repositoryName}/actions/workflows/${workflow}/dispatches`,
    issueBase: `${uiHost.origin}/project/${projectId}/error_tracking`,
    ref: workflowRef(),
  };
}

async function dispatchWorkflow(
  workflowUrl: string,
  payload: Record<string, unknown>,
  ref: string,
  githubToken: string,
) {
  const response = await fetch(workflowUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "hypertask-posthog-error-alert",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref,
      inputs: { posthog_payload: JSON.stringify(payload) },
    }),
    cache: "no-store",
  });
  if (response.status !== 204) {
    throw new Error(`GitHub workflow dispatch returned HTTP ${response.status}`);
  }
}

export async function POST(request: NextRequest) {
  if (
    !(await isFeatureEnabled(
      POSTHOG_ERROR_ALERT_FLAG,
      FEATURE_FLAG_OWNER_USER_ID,
    ))
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let rawBody: string;
  let verified: unknown;
  try {
    const reader = request.body?.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          return NextResponse.json(
            { error: "Payload too large" },
            { status: 413 },
          );
        }
        chunks.push(Buffer.from(value));
      }
    }
    rawBody = Buffer.concat(chunks).toString("utf8");
    verified = verifyWebhook(rawBody, request);
  } catch (error) {
    console.warn("[posthog-error-alert] rejected webhook", error);
    return NextResponse.json({ error: "Invalid webhook" }, { status: 401 });
  }

  const alert = parsePostHogExceptionAlert(
    verified,
    requiredEnv("POSTHOG_ERROR_EVENT_SECRET"),
  );
  if (!alert) {
    return NextResponse.json({ error: "Invalid error event" }, { status: 400 });
  }

  const configuration = dispatchConfiguration();
  const redis = await getRedis();
  const claim = await claimPostHogAlert(redis, alert);
  if (!claim.accepted) {
    return claim.retryable
      ? NextResponse.json({ error: "Alert is still processing" }, { status: 503 })
      : new NextResponse(null, { status: 204 });
  }

  const shouldDispatch = claim.firstFingerprint || claim.spike;
  if (!shouldDispatch) {
    await commitPostHogAlertClaim(redis, alert, claim);
    return new NextResponse(null, { status: 204 });
  }

  const alertKind = claim.spike ? "server_error_spike" : "new_server_error";
  const issueUrl = `${configuration.issueBase}/fingerprint/${alert.fingerprint}?timestamp=${encodeURIComponent(alert.timestamp)}`;

  const workflowPayload = {
    alert_kind: alertKind,
    count: claim.count,
    dispatched_at: new Date().toISOString(),
    environment: alert.environment,
    event_id: alert.eventId,
    fingerprint: alert.fingerprint,
    issue_url: issueUrl,
    message: alert.message,
    name: alert.name,
    release: alert.release,
    timestamp: alert.timestamp,
  };

  try {
    await dispatchWorkflow(
      configuration.githubWorkflowUrl,
      {
        ...workflowPayload,
        dispatch_signature: signWorkflowPayload(
          workflowPayload,
          requiredEnv("POSTHOG_ALERT_DISPATCH_SECRET"),
        ),
      },
      configuration.ref,
      configuration.githubToken,
    );
  } catch (error) {
    try {
      await releasePostHogAlertClaim(redis, alert, claim);
    } catch (releaseError) {
      console.error(
        "[posthog-error-alert] claim release failed",
        releaseError,
      );
    }
    console.error("[posthog-error-alert] dispatch failed", error);
    return NextResponse.json({ error: "Dispatch failed" }, { status: 503 });
  }

  try {
    await commitPostHogAlertClaim(redis, alert, claim);
  } catch (error) {
    // GitHub accepted the workflow. Returning 503 here would invite PostHog
    // to send the same rollback dispatch again.
    console.error("[posthog-error-alert] claim commit failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
