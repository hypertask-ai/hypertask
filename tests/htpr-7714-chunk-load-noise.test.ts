import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureResult } from "posthog-js";

import {
  dropResizeObserverLoopException,
  dropSelfRecoveringChunkLoadException,
} from "../src/lib/analytics/browserNoise";
import { handleClientRejection } from "../src/components/ErrorBoundary/ClientErrorReporter";
import type { ClientErrorPayload } from "../src/lib/telemetry/reportClientError";

const exceptionEvent = (
  entries: Array<{ type: string; value: string }>,
): CaptureResult =>
  ({
    uuid: "event-1",
    event: "$exception",
    properties: {
      $current_url: "https://app.hypertask.ai/detail/project-339/1583",
      $exception_types: entries.map((entry) => entry.type),
      $exception_list: entries.map((entry) => ({
        ...entry,
        mechanism: { exception_id: 0, handled: false, synthetic: false, type: "generic" },
        stacktrace: {
          type: "raw",
          frames: [
            {
              filename:
                "https://app.hypertask.ai/_next/static/chunks/webpack-5a34f09fce79bdf8.js?dpl=dpl_6xhr4m2SeLFFd7egY4qFYMYjoyat",
              function: "e",
              in_app: true,
              lineno: 1,
              colno: 120442,
            },
          ],
        },
      })),
    },
  }) as CaptureResult;

const staleDeployChunk = {
  type: "ChunkLoadError",
  value:
    "Loading chunk 10295 failed.\n(error: https://app.hypertask.ai/_next/static/chunks/10295.ed4945978da0b9fa.js?dpl=dpl_6xhr4m2SeLFFd7egY4qFYMYjoyat)",
};

test("a chunk from an older deploy that the app reloads to recover is not sent to PostHog", () => {
  assert.equal(dropSelfRecoveringChunkLoadException(exceptionEvent([staleDeployChunk])), null);
  assert.equal(
    dropSelfRecoveringChunkLoadException(
      exceptionEvent([
        {
          type: "TypeError",
          value: "Failed to fetch dynamically imported module: https://app.hypertask.ai/x.js",
        },
      ]),
    ),
    null,
  );
});

test("the drop holds when chained after the ResizeObserver filter as PostHog init does", () => {
  assert.equal(
    dropSelfRecoveringChunkLoadException(
      dropResizeObserverLoopException(exceptionEvent([staleDeployChunk])),
    ),
    null,
  );
});

test("still allowed: real exceptions and mixed lists reach PostHog", () => {
  const real = exceptionEvent([
    { type: "TypeError", value: "Cannot read properties of undefined (reading 'id')" },
  ]);
  assert.equal(dropSelfRecoveringChunkLoadException(real), real);

  const mixed = exceptionEvent([
    staleDeployChunk,
    { type: "TypeError", value: "Cannot read properties of undefined (reading 'id')" },
  ]);
  assert.equal(dropSelfRecoveringChunkLoadException(mixed), mixed);
});

test("still allowed: non-exception events and empty exception lists pass through", () => {
  const pageview = { uuid: "event-2", event: "$pageview", properties: {} } as CaptureResult;
  assert.equal(dropSelfRecoveringChunkLoadException(pageview), pageview);

  const empty = exceptionEvent([]);
  assert.equal(dropSelfRecoveringChunkLoadException(empty), empty);
  assert.equal(dropSelfRecoveringChunkLoadException(null), null);
});

const chunkRejection = () =>
  Object.assign(new Error(staleDeployChunk.value), { name: "ChunkLoadError" });

const rejectionEnvironment = (previousAttempt: string | null) => {
  const reports: ClientErrorPayload[] = [];
  const recoveries: string[] = [];
  return {
    reports,
    recoveries,
    environment: {
      href: "https://app.hypertask.ai/detail/project-339/1583",
      currentHref: () => "https://app.hypertask.ai/detail/project-339/1583",
      previousAttempt,
      claimRecovery: () => true,
      releaseRecovery: () => {},
      canReach: async () => true,
      recover: (url: string) => {
        recoveries.push(url);
      },
      report: (payload: ClientErrorPayload) => {
        reports.push(payload);
      },
    },
  };
};

test("still reported: a chunk failure that survives every recovery reload reaches the app error report", async () => {
  const { reports, recoveries, environment } = rejectionEnvironment("2");
  await handleClientRejection(chunkRejection(), environment);
  assert.equal(recoveries.length, 0);
  assert.equal(reports.length, 1);
  assert.match(reports[0].message ?? "", /Loading chunk 10295 failed/);
});

test("a first chunk failure reloads the page instead of reporting", async () => {
  const { reports, recoveries, environment } = rejectionEnvironment(null);
  await handleClientRejection(chunkRejection(), environment);
  assert.equal(reports.length, 0);
  assert.equal(recoveries.length, 1);
  assert.match(recoveries[0], /__ht_chunk_reload=1-/);
});
