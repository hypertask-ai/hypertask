import assert from "node:assert/strict";
import test from "node:test";

import {
  handleClientRejection,
  readChunkRecoveryAttempt,
} from "../src/components/ErrorBoundary/ClientErrorReporter";

const chunkError = Object.assign(
  new Error(
    "Loading chunk 23953 failed. (error: https://app.hypertask.ai/_next/static/chunks/23953.js)",
  ),
  { name: "ChunkLoadError" },
);

test("an unhandled chunk rejection recovers the current page without reporting it", async () => {
  const reports: unknown[] = [];
  const recoveries: Array<{ url: string; attempt: number }> = [];
  let preflightUrl = "";

  await handleClientRejection(chunkError, {
    href: "https://app.hypertask.ai/share?id=public-task#comments",
    currentHref: () => "https://app.hypertask.ai/share?id=public-task#comments",
    previousAttempt: null,
    canReach: async (url) => {
      preflightUrl = url;
      return true;
    },
    claimRecovery: () => true,
    releaseRecovery: () => assert.fail("successful recovery keeps its claim until navigation"),
    recover: (url, attempt) => recoveries.push({ url, attempt }),
    report: (payload) => reports.push(payload),
  });

  assert.equal(reports.length, 0);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0]?.attempt, 1);
  assert.equal(recoveries[0]?.url, preflightUrl);

  const recovered = new URL(recoveries[0]!.url);
  assert.equal(recovered.pathname, "/share");
  assert.equal(recovered.searchParams.get("id"), "public-task");
  assert.match(recovered.searchParams.get("__ht_chunk_reload") || "", /^1-\d+$/);
  assert.equal(recovered.hash, "#comments");
});

test("an unhandled chunk rejection still reports when safe recovery cannot proceed", async () => {
  const reports: Array<{ source: string; message?: string }> = [];
  let released = false;

  await handleClientRejection(chunkError, {
    href: "https://app.hypertask.ai/share?id=public-task",
    currentHref: () => "https://app.hypertask.ai/share?id=public-task",
    previousAttempt: null,
    canReach: async () => false,
    claimRecovery: () => true,
    releaseRecovery: () => {
      released = true;
    },
    recover: () => assert.fail("an unreachable page must not replace the current page"),
    report: (payload) => reports.push(payload),
  });

  assert.equal(released, true);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.source, "unhandledrejection");
  assert.match(reports[0]?.message || "", /Loading chunk 23953 failed/);
});

test("ordinary unhandled rejections keep the existing reporting path", async () => {
  const reports: Array<{ source: string; message?: string }> = [];

  await handleClientRejection(new Error("ordinary failure"), {
    href: "https://app.hypertask.ai/inbox",
    currentHref: () => "https://app.hypertask.ai/inbox",
    previousAttempt: null,
    canReach: async () => assert.fail("ordinary errors must not preflight a reload"),
    claimRecovery: () => assert.fail("ordinary errors must not claim recovery"),
    releaseRecovery: () => assert.fail("ordinary errors must not release recovery"),
    recover: () => assert.fail("ordinary errors must not reload"),
    report: (payload) => reports.push(payload),
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.source, "unhandledrejection");
  assert.equal(reports[0]?.message, "ordinary failure");
});

test("concurrent chunk rejections share one recovery navigation", async () => {
  const reports: unknown[] = [];
  const recoveries: string[] = [];
  let claimed = false;
  let finishPreflight!: (reachable: boolean) => void;
  const preflight = new Promise<boolean>((resolve) => {
    finishPreflight = resolve;
  });
  const environment = {
    href: "https://app.hypertask.ai/share?id=public-task",
    currentHref: () => "https://app.hypertask.ai/share?id=public-task",
    previousAttempt: null,
    canReach: async () => preflight,
    claimRecovery: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    releaseRecovery: () => {
      claimed = false;
    },
    recover: (url: string) => recoveries.push(url),
    report: (payload: unknown) => reports.push(payload),
  };

  const first = handleClientRejection(chunkError, environment);
  const second = handleClientRejection(chunkError, environment);
  await second;
  finishPreflight(true);
  await first;

  assert.equal(recoveries.length, 1);
  assert.equal(reports.length, 0);
});

test("navigation during preflight cancels stale recovery and releases its claim", async () => {
  const originalHref = "https://app.hypertask.ai/share?id=public-task";
  let currentHref = originalHref;
  let released = false;
  let finishPreflight!: (reachable: boolean) => void;
  const preflight = new Promise<boolean>((resolve) => {
    finishPreflight = resolve;
  });

  const recovery = handleClientRejection(chunkError, {
    href: originalHref,
    currentHref: () => currentHref,
    previousAttempt: null,
    canReach: async () => preflight,
    claimRecovery: () => true,
    releaseRecovery: () => {
      released = true;
    },
    recover: () => assert.fail("recovery must not replace a newer page"),
    report: () => assert.fail("a stale page failure must not be reported"),
  });

  currentHref = "https://app.hypertask.ai/inbox";
  finishPreflight(true);
  await recovery;

  assert.equal(released, true);
});

test("a new page can recover while stale-page recovery is being cancelled", async () => {
  const staleHref = "https://app.hypertask.ai/share?id=public-task";
  let currentHref = staleHref;
  const claims = new Set<string>();
  const reports: unknown[] = [];
  const recoveries: string[] = [];
  let finishStalePreflight!: (reachable: boolean) => void;
  const stalePreflight = new Promise<boolean>((resolve) => {
    finishStalePreflight = resolve;
  });
  const claimRecovery = (href: string) => {
    if (claims.has(href)) return false;
    claims.add(href);
    return true;
  };
  const releaseRecovery = (href: string) => {
    claims.delete(href);
  };

  const staleRecovery = handleClientRejection(chunkError, {
    href: staleHref,
    currentHref: () => currentHref,
    previousAttempt: null,
    canReach: async () => stalePreflight,
    claimRecovery,
    releaseRecovery,
    recover: () => assert.fail("stale recovery must not navigate"),
    report: (payload) => reports.push(payload),
  });

  currentHref = "https://app.hypertask.ai/inbox";
  const currentRecovery = handleClientRejection(chunkError, {
    href: currentHref,
    currentHref: () => currentHref,
    previousAttempt: null,
    canReach: async () => true,
    claimRecovery,
    releaseRecovery,
    recover: (url) => recoveries.push(url),
    report: (payload) => reports.push(payload),
  });

  finishStalePreflight(true);
  await Promise.all([staleRecovery, currentRecovery]);

  assert.equal(recoveries.length, 1);
  assert.equal(new URL(recoveries[0]!).pathname, "/inbox");
  assert.equal(reports.length, 0);
  assert.equal(claims.has(staleHref), false);
  assert.equal(claims.has(currentHref), true);
});

test("recovery exceptions release the claim and report the original rejection", async () => {
  const reports: Array<{ message?: string }> = [];
  let releases = 0;
  const environment = {
    href: "https://app.hypertask.ai/share?id=public-task",
    currentHref: () => "https://app.hypertask.ai/share?id=public-task",
    previousAttempt: null,
    claimRecovery: () => true,
    releaseRecovery: () => {
      releases += 1;
    },
    recover: () => assert.fail("a failed preflight must not navigate"),
    report: (payload: { message?: string }) => reports.push(payload),
  };

  await handleClientRejection(chunkError, {
    ...environment,
    canReach: async () => {
      throw new Error("preflight failed");
    },
  });
  await handleClientRejection(chunkError, {
    ...environment,
    canReach: async () => true,
    recover: () => {
      throw new Error("storage blocked");
    },
  });

  assert.equal(releases, 2);
  assert.equal(reports.length, 2);
  assert.match(reports[0]?.message || "", /Loading chunk 23953 failed/);
  assert.match(reports[1]?.message || "", /Loading chunk 23953 failed/);
});

test("blocked session storage falls back to a fresh recovery attempt", () => {
  assert.equal(
    readChunkRecoveryAttempt(() => ({ getItem: () => "1" })),
    "1",
  );
  assert.equal(
    readChunkRecoveryAttempt(() => {
      throw new Error("storage unavailable");
    }),
    null,
  );
  assert.equal(
    readChunkRecoveryAttempt(() => ({
      getItem: () => {
        throw new Error("storage read blocked");
      },
    })),
    null,
  );
});
