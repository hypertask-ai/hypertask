const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const {
  sanitizeBoardFilters,
  sanitizeProjectBoardFilters,
  sanitizeViewBoardFilters,
} = jiti(
  path.join(
    root,
    "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts",
  ),
);

test("board filter payloads retain only explicitly allowed fields", () => {
  const filters = {
    matchFilters: "ANY",
    addedFilters: [
      {
        type: "Assignees",
        searchPayload: [
          {
            id: "agent-1",
            displayName: "Mobile Developer",
            photoURL: "/agent.png",
            createdAt: "2026-08-06T00:00:00.000Z",
            mcpToken: "live-bearer-token",
            mcpTokenExpiresAt: null,
            permissions: { role: "write" },
            postsToImportant: true,
            revokedAt: null,
            userId: 6,
          },
        ],
      },
    ],
  };

  assert.deepEqual(sanitizeBoardFilters(filters), {
    matchFilters: "ANY",
    addedFilters: [
      {
        type: "Assignees",
        searchPayload: [
          {
            id: "agent-1",
            displayName: "Mobile Developer",
            photoURL: "/agent.png",
          },
        ],
      },
    ],
  });
});

test("ordinary user payloads retain the fields used by filter rendering and matching", () => {
  const filters = {
    matchFilters: "ALL",
    addedFilters: [
      {
        type: "Assignees",
        match: "ANY",
        searchPayload: [
          {
            id: 42,
            uid: "firebase-user-42",
            displayName: "Person",
            photoURL: "/person.png",
            email: "person@example.com",
          },
        ],
      },
    ],
  };

  assert.deepEqual(sanitizeBoardFilters(filters), {
    matchFilters: "ALL",
    addedFilters: [
      {
        type: "Assignees",
        match: "ANY",
        searchPayload: [
          {
            id: 42,
            uid: "firebase-user-42",
            displayName: "Person",
            photoURL: "/person.png",
          },
        ],
      },
    ],
  });
});

test("already-clean board filters are unchanged", () => {
  const filters = {
    matchFilters: "ANY",
    addedFilters: [
      {
        type: "Labels",
        searchPayload: [{ id: "label-1", value: "Security" }],
      },
      {
        type: "Priority",
        searchPayload: [
          { priority_index: 1, Priority_Value: "Urgent" },
        ],
      },
      {
        type: "UpdatedRange",
        searchPayload: [
          {
            fromDate: null,
            toDate: null,
            selectedDate: null,
            condition: null,
            dynamicRange: "TODAY",
          },
        ],
      },
    ],
  };

  assert.strictEqual(sanitizeBoardFilters(filters), filters);
});

test("nested board view responses sanitize existing stored payloads", () => {
  const poisonedFilters = {
    matchFilters: "ANY",
    addedFilters: [
      {
        type: "Assignees",
        searchPayload: [
          {
            id: "agent-1",
            displayName: "Mobile Developer",
            mcpToken: "live-bearer-token",
          },
        ],
      },
    ],
  };
  const project = {
    id: 15,
    project_view: {
      default_view: { id: "default", board_filters: poisonedFilters },
      allViews: [{ id: "public", board_filters: poisonedFilters }],
      user_project_views: [
        {
          appliedView: { id: "applied", board_filters: poisonedFilters },
          unsavedView: { id: "unsaved", board_filters: poisonedFilters },
        },
      ],
    },
  };

  const sanitized = sanitizeProjectBoardFilters(project);
  assert.equal(JSON.stringify(sanitized).includes("mcpToken"), false);
  assert.equal(JSON.stringify(project).includes("mcpToken"), true);
});

test("lazy board hydration sanitizes each returned saved view", () => {
  const views = [
    {
      id: "public",
      board_filters: {
        matchFilters: "ANY",
        addedFilters: [
          {
            type: "Assignees",
            searchPayload: [
              {
                id: "agent-1",
                displayName: "Mobile Developer",
                mcpToken: "live-bearer-token",
              },
            ],
          },
        ],
      },
    },
  ];

  const sanitized = views.map(sanitizeViewBoardFilters);
  assert.equal(JSON.stringify(sanitized).includes("mcpToken"), false);
  assert.equal(JSON.stringify(views).includes("mcpToken"), true);
});
