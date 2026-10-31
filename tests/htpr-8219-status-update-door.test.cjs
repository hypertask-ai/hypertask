const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-8219-status-update-door";
const RESULT = { url: "/report/15/status-update", headline: "Board is moving", title: "Status update — 2026-10-30" };

function request(body) {
  return { json: async () => body };
}

class BoardNotFound extends Error {}
class Disabled extends Error {}
class GenerationFailed extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

function world({ enabled = true, authed = true, result = RESULT, throwError = null, args = [] } = {}) {
  const flags = [];
  const crashes = [];
  const { POST } = load("src/lib/mcp/operations/reports/status-update/operation.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (handler) => handler },
    "@/lib/mcp/auth": {
      validateMcpAuth: async () => (authed ? { user: { id: 6 }, agentId: null, teamScope: null } : null),
      checkMcpRateLimit: async () => null,
    },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (_request, error) => crashes.push(error) },
    "@/lib/flags": {
      isFeatureEnabled: async (key, userId) => {
        flags.push({ key, userId });
        return enabled;
      },
    },
    "@/utils/controllers/reports/statusUpdate": {
      generateStatusUpdateReport: async (input) => {
        args.push(input);
        if (throwError === "board") throw new BoardNotFound("Board not found");
        if (throwError === "disabled") throw new Disabled("Status updates are turned off for this team");
        if (throwError === "generation") throw new GenerationFailed("Could not generate the status update", new Error("model call failed"));
        if (throwError === "funding") {
          const error = new Error("Add a team AI key to continue");
          error.name = "TeamKeyOnlyRefusal";
          throw error;
        }
        return result;
      },
      StatusUpdateBoardNotFoundError: BoardNotFound,
      StatusUpdatesDisabledError: Disabled,
      StatusUpdateGenerationError: GenerationFailed,
    },
  });
  return { POST, flags, args, crashes };
}

test("flag is an Everyone-default improvement with a release risk", () => {
  const { default: definition, HTPR_8219_STATUS_UPDATE_DOOR_FLAG } = load(
    "src/lib/flags/definitions/htpr-8219-status-update-door.ts",
    {},
  );
  assert.equal(HTPR_8219_STATUS_UPDATE_DOOR_FLAG, FLAG);
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(require("../e2e/smoke/production-flag-modes.json").modes[FLAG], "EVERYONE");
});

test("with the flag on the agent door drafts the status update and saves it", async () => {
  const { POST, args } = world();
  const response = await POST(request({ project_id: 15, range: "7d" }));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, ...RESULT });
  assert.deepEqual(args, [{
    projectId: 15,
    userId: 6,
    actingAgentId: null,
    teamScope: null,
    range: "7d",
  }]);
});

test("a status update request without a range lets the report pick its own window", async () => {
  const { POST, args } = world();
  await POST(request({ project_id: 15 }));
  assert.equal(args[0].range, null);
});

test("with the flag off the door is absent and nothing is generated", async () => {
  const { POST, flags, args } = world({ enabled: false });
  const response = await POST(request({ project_id: 15 }));
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { success: false, error: "Not found" });
  assert.deepEqual(args, []);
  assert.deepEqual(flags, [{ key: FLAG, userId: 6 }]);
});

test("an unsigned request is refused before the flag is read", async () => {
  const { POST, flags } = world({ authed: false });
  const response = await POST(request({ project_id: 15 }));
  assert.equal(response.status, 401);
  assert.deepEqual(flags, []);
});

test("a missing project_id is a field error, not a draft", async () => {
  const { POST, args } = world();
  const response = await POST(request({}));
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "missing_field");
  assert.equal(response.body.field, "project_id");
  assert.deepEqual(args, []);
});

test("a board the caller cannot see is refused as not found", async () => {
  const { POST } = world({ throwError: "board" });
  const response = await POST(request({ project_id: 99 }));
  assert.equal(response.status, 404);
  assert.equal(response.body.error, "Board not found");
});

test("a team with status updates turned off gets a plain refusal", async () => {
  const { POST } = world({ throwError: "disabled" });
  const response = await POST(request({ project_id: 15 }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Status updates are turned off for this team");
});

test("a team requiring an AI key gets a clear refusal without a crash report", async () => {
  const { POST, crashes } = world({ throwError: "funding" });
  const response = await POST(request({ project_id: 15 }));
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { success: false, error: "Add a team AI key to continue" });
  assert.deepEqual(crashes, []);
});

test("a model failure is a 502 that reports the real cause", async () => {
  const { POST, crashes } = world({ throwError: "generation" });
  const response = await POST(request({ project_id: 15 }));
  assert.equal(response.status, 502);
  assert.equal(response.body.error, "Could not generate the status update");
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0].message, "model call failed");
});
