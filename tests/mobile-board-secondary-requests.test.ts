import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldEnableSecondaryStartup,
  shouldReleaseSecondaryStartupForTerminalBoard,
  shouldReleaseSecondaryStartupOnBoardRequest,
} from "../src/lib/boardStartup/secondaryRequests";

test("mobile secondary traffic waits for usable Board release", () => {
  assert.equal(
    shouldReleaseSecondaryStartupOnBoardRequest({ isMobile: true }),
    false,
  );
  assert.equal(
    shouldEnableSecondaryStartup({
      hasAuthenticatedUser: true,
      projectRoute: true,
      releasedForAccount: false,
    }),
    false,
  );
  assert.equal(
    shouldEnableSecondaryStartup({
      hasAuthenticatedUser: true,
      projectRoute: true,
      releasedForAccount: true,
    }),
    true,
  );
});

test("desktop retains request-settled release timing", () => {
  assert.equal(
    shouldReleaseSecondaryStartupOnBoardRequest({ isMobile: false }),
    true,
  );
});

test("authenticated non-project routes do not wait for Board readiness", () => {
  assert.equal(
    shouldEnableSecondaryStartup({
      hasAuthenticatedUser: true,
      projectRoute: false,
      releasedForAccount: false,
    }),
    true,
  );
});

test("logged-out routes do not start authenticated secondary requests", () => {
  assert.equal(
    shouldEnableSecondaryStartup({
      hasAuthenticatedUser: false,
      projectRoute: false,
      releasedForAccount: false,
    }),
    false,
  );
});

test("a merely slow mobile Board keeps secondary traffic gated", () => {
  assert.equal(
    shouldReleaseSecondaryStartupForTerminalBoard({
      isMobile: true,
      isFetching: true,
      hasNoBoards: false,
      hasNoSelectedBoard: false,
      projectsError: false,
      accessDenied: false,
      projectLookupFailed: false,
      hydrationFailed: false,
    }),
    false,
  );
});

test("terminal mobile Board states release services needed for recovery", () => {
  const base = {
    isMobile: true,
    isFetching: false,
    hasNoBoards: false,
    hasNoSelectedBoard: false,
    projectsError: false,
    accessDenied: false,
    projectLookupFailed: false,
    hydrationFailed: false,
  };

  for (const terminalState of [
    { hasNoBoards: true },
    { hasNoSelectedBoard: true },
    { projectsError: true },
    { accessDenied: true },
    { projectLookupFailed: true },
    { hydrationFailed: true },
  ]) {
    assert.equal(
      shouldReleaseSecondaryStartupForTerminalBoard({
        ...base,
        ...terminalState,
      }),
      true,
    );
  }

  assert.equal(
    shouldReleaseSecondaryStartupForTerminalBoard({
      ...base,
      isMobile: false,
      hydrationFailed: true,
    }),
    false,
  );
});
