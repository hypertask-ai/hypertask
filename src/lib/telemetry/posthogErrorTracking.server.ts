import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";

import type { ErrorReport } from "@/lib/errors/reportError";
import { errorFingerprint } from "@/lib/errors/errorFingerprint";
import {
  redactErrorText,
  safeErrorExtra,
  safeErrorUrl,
} from "@/lib/telemetry/errorSanitization";
import { postHogErrorEventSignature } from "@/lib/telemetry/posthogErrorAlert";

const MESSAGE_LIMIT = 1000;
const STACK_LIMIT = 16_000;
const CAPTURE_TIMEOUT_MS = 1500;
let client: PostHog | undefined;

function deploymentEnvironment() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
}

function releaseSha() {
  const value =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_BUILD_ID ||
    "";
  return /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : undefined;
}

function postHogClient() {
  const token = process.env.POSTHOG_SERVER_PROJECT_TOKEN?.trim();
  if (!token) return undefined;
  if (!client) {
    client = new PostHog(token, {
      host: process.env.POSTHOG_SERVER_HOST || "https://eu.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: CAPTURE_TIMEOUT_MS,
      disableGeoip: true,
    });
  }
  return client;
}

export async function capturePostHogExceptionOnServer(report: ErrorReport) {
  const environment = deploymentEnvironment();
  if (environment !== "production" && environment !== "preview") return false;

  const posthog = postHogClient();
  const eventSecret = process.env.POSTHOG_ERROR_EVENT_SECRET?.trim();
  const release = releaseSha();
  if (!posthog || !eventSecret || !release) return false;

  const error = new Error(
    redactErrorText(report.message, MESSAGE_LIMIT) || "Unknown server error",
  );
  if (report.stack) {
    error.stack = redactErrorText(report.stack, STACK_LIMIT);
  }
  const fingerprint = errorFingerprint(report.message, report.stack);
  const nonce = randomUUID();
  const occurredAt = new Date().toISOString();
  const signature = postHogErrorEventSignature(
    {
      source: report.source,
      environment,
      release,
      fingerprint,
      eventId: nonce,
      timestamp: occurredAt,
      name: error.name,
      message: error.message,
    },
    eventSecret,
  ).toString("hex");

  await posthog.captureExceptionImmediate(error, "hypertask-app", {
    ...safeErrorExtra(report.extra),
    $exception_fingerprint: fingerprint,
    ht_source: report.source,
    ht_environment: environment,
    ht_release: release,
    ht_fingerprint: fingerprint,
    ht_event_nonce: nonce,
    ht_event_signature: signature,
    ht_occurred_at: occurredAt,
    ht_url: safeErrorUrl(report.url),
  });
  return true;
}
