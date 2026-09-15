import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMyTasksScopeOr,
  DEFAULT_MY_TASKS_SCOPES,
  effectiveMyTasksScopes,
  normalizeMyTasksScopes,
} from "../src/lib/myTasksScopes";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  parseMyTasksViewConfig,
} from "../src/models/MyTasksView";

test("normalizeMyTasksScopes allowlists, dedupes, and defaults", () => {
  assert.deepEqual(normalizeMyTasksScopes(undefined), DEFAULT_MY_TASKS_SCOPES);
  assert.deepEqual(normalizeMyTasksScopes([]), DEFAULT_MY_TASKS_SCOPES);
  assert.deepEqual(normalizeMyTasksScopes(["nope", 1, null]), DEFAULT_MY_TASKS_SCOPES);
  assert.deepEqual(normalizeMyTasksScopes(["watching", "watching", "created"]), [
    "created",
    "watching",
  ]);
  assert.deepEqual(
    normalizeMyTasksScopes(["mentioned", "assigned", "created", "watching"]),
    ["assigned", "created", "mentioned", "watching"],
  );
});

test("effectiveMyTasksScopes forces assigned when the flag is off", () => {
  assert.deepEqual(
    effectiveMyTasksScopes(["created", "watching"], false),
    DEFAULT_MY_TASKS_SCOPES,
  );
  assert.deepEqual(effectiveMyTasksScopes(["created"], true), ["created"]);
});

test("parseMyTasksViewConfig keeps scopes when present and defaults when missing", () => {
  assert.deepEqual(parseMyTasksViewConfig(null).scopes, DEFAULT_MY_TASKS_SCOPES);
  assert.deepEqual(
    parseMyTasksViewConfig({ scopes: ["watching", "watching", "bad"] }).scopes,
    ["watching"],
  );
  assert.deepEqual(
    parseMyTasksViewConfig({
      scopes: ["created", "mentioned"],
      sort: { field: "title", direction: "desc" },
    }).scopes,
    ["created", "mentioned"],
  );
  assert.equal(
    JSON.stringify(parseMyTasksViewConfig({ scopes: ["created"] }).scopes),
    JSON.stringify(["created"]),
  );
  // Flag-off saves still round-trip scopes through parse so rollout does not wipe them.
  assert.deepEqual(DEFAULT_MY_TASKS_VIEW_CONFIG.scopes, DEFAULT_MY_TASKS_SCOPES);
});

test("buildMyTasksScopeOr emits one human-safe clause per scope", () => {
  const clauses = buildMyTasksScopeOr(6, [
    "assigned",
    "created",
    "watching",
    "mentioned",
  ]);
  assert.equal(clauses.length, 4);
  assert.deepEqual(clauses[0], {
    assignees: { some: { userId: 6, agentId: null } },
  });
  assert.deepEqual(clauses[1], { userId: 6 });
  assert.deepEqual(clauses[2], {
    OR: [
      {
        comments: {
          some: { text: { contains: 'data-label="name-6"' } },
        },
      },
      { description: { contains: 'data-label="name-6"' } },
    ],
  });
  assert.deepEqual(clauses[3], {
    followers: { some: { userId: 6, agentId: null } },
  });
});

test("buildMyTasksScopeOr collapses empty input to assigned", () => {
  assert.deepEqual(buildMyTasksScopeOr(9, []), [
    { assignees: { some: { userId: 9, agentId: null } } },
  ]);
});
