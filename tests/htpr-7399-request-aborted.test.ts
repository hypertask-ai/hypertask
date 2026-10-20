import assert from "node:assert/strict";
import test from "node:test";

import { handleClientRejection } from "../src/components/ErrorBoundary/ClientErrorReporter";
import { reportClientError } from "../src/lib/telemetry/reportClientError";
import { safeErrorExtra } from "../src/lib/telemetry/errorSanitization";

type Outcome = "abort" | "timeout" | "forbidden";

class FakeXMLHttpRequest {
  static outcome: Outcome = "abort";
  readyState = 0;
  status = 0;
  statusText = "";
  responseText = "";
  response = "";
  responseURL = "";
  timeout = 0;
  withCredentials = false;
  onloadend: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  ontimeout: (() => void) | null = null;
  open() {
    this.readyState = 1;
  }
  setRequestHeader() {}
  getAllResponseHeaders() {
    return "content-type: application/json";
  }
  addEventListener() {}
  abort() {}
  send() {
    setTimeout(() => {
      if (FakeXMLHttpRequest.outcome === "abort") return this.onabort?.();
      if (FakeXMLHttpRequest.outcome === "timeout") return this.ontimeout?.();
      this.readyState = 4;
      this.status = 403;
      this.statusText = "Forbidden";
      this.responseText = this.response = '{"message":"No access"}';
      this.onloadend?.();
    });
  }
}

async function axiosRejection(outcome: Outcome) {
  FakeXMLHttpRequest.outcome = outcome;
  const { default: axios } = await import("axios");
  const client = axios.create({ adapter: "xhr", timeout: 1000 });
  try {
    await client.get("https://app.hypertask.ai/api/projects/15/tasks?search=x");
  } catch (error) {
    return error;
  }
  assert.fail(`${outcome} request should reject`);
}

test("an aborted axios request is browser cancellation and sends no error beacon, while real failures still report", async () => {
  const beacons: unknown[] = [];
  Object.assign(globalThis, {
    XMLHttpRequest: FakeXMLHttpRequest,
    window: { location: { href: "https://app.hypertask.ai/project" } },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      webdriver: false,
      userAgent: "Mozilla/5.0 Firefox/151.0",
      sendBeacon(_url: string, body: Blob) {
        beacons.push(body);
        return true;
      },
    },
  });
  const environment = {
    href: "https://app.hypertask.ai/project",
    currentHref: () => "https://app.hypertask.ai/project",
    previousAttempt: null,
    canReach: async () => false,
    claimRecovery: () => true,
    releaseRecovery: () => {},
    recover: () => assert.fail("network rejections never recover a chunk"),
    report: reportClientError,
  };

  const aborted = await axiosRejection("abort");
  assert.equal((aborted as Error).message, "Request aborted");
  await handleClientRejection(aborted, environment);
  assert.equal(beacons.length, 0, "a browser-aborted request is expected cancellation");

  await handleClientRejection(await axiosRejection("timeout"), environment);
  assert.equal(beacons.length, 1, "an axios timeout shares ECONNABORTED and still reports");

  await handleClientRejection(new Error("Request aborted"), environment);
  assert.equal(beacons.length, 2, "a non-axios rejection with the same words still reports");

  await handleClientRejection(await axiosRejection("forbidden"), environment);
  assert.equal(beacons.length, 3, "an HTTP 403 still reports");

  const body = JSON.parse(await (beacons[2] as Blob).text());
  assert.equal(body.extra.axiosCode, "ERR_BAD_REQUEST");
  assert.equal(body.extra.requestPath, "/api/projects/15/tasks");
  assert.equal(body.extra.responseStatus, 403);
});

test("PostHog error events keep which request failed, without query strings or opaque ids", () => {
  assert.deepEqual(
    safeErrorExtra({
      axiosCode: "ECONNABORTED",
      requestMethod: "GET",
      requestPath: "/api/tasks/3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c/comments",
      responseStatus: 403,
      responseMessage: "No access for valentin@example.com",
      origin: "unhandledrejection",
    }),
    {
      ht_axiosCode: "ECONNABORTED",
      ht_requestMethod: "GET",
      ht_requestPath: "/api/tasks/[redacted]/comments",
      ht_responseStatus: 403,
      ht_origin: "unhandledrejection",
    },
  );
});
