import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureResult } from "posthog-js";

import { dropResizeObserverLoopException } from "../src/lib/analytics/browserNoise";

const exceptionEvent = (values: string[]): CaptureResult =>
  ({
    uuid: "event-1",
    event: "$exception",
    properties: {
      $current_url: "https://app.hypertask.ai/detail/project-339/1754",
      $exception_list: values.map((value) => ({
        type: "Error",
        value,
        mechanism: { handled: false, synthetic: true, type: "generic" },
      })),
    },
  }) as CaptureResult;

test("the browser's ResizeObserver loop warning is not sent to PostHog", () => {
  assert.equal(
    dropResizeObserverLoopException(
      exceptionEvent([
        "ResizeObserver loop completed with undelivered notifications.",
      ]),
    ),
    null,
  );
});

test("still allowed: real exceptions reach PostHog", () => {
  const real = exceptionEvent(["Request failed with status code 500"]);
  assert.equal(dropResizeObserverLoopException(real), real);

  const mixed = exceptionEvent([
    "ResizeObserver loop completed with undelivered notifications.",
    "Cannot read properties of undefined (reading 'id')",
  ]);
  assert.equal(dropResizeObserverLoopException(mixed), mixed);
});

test("still allowed: non-exception events and empty exception lists pass through", () => {
  const pageview = {
    uuid: "event-2",
    event: "$pageview",
    properties: {},
  } as CaptureResult;
  assert.equal(dropResizeObserverLoopException(pageview), pageview);

  const empty = exceptionEvent([]);
  assert.equal(dropResizeObserverLoopException(empty), empty);
  assert.equal(dropResizeObserverLoopException(null), null);
});
