const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let queryOptions;
let projectLookups = 0;

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/lib/prisma.ts", { default: { project: { findUnique: async ({ where }) => {
  projectLookups++;
  if (!Number.isInteger(where.id)) throw new Error("PrismaClientValidationError");
  return null;
} } } });
stub("src/lib/telemetry/activationOccurrences.ts", { captureActivationOccurrence: async () => null });
stub("src/pages/api/invite/createInviteLink.ts", { generateInviteLink: async () => "", setViewSlug: () => undefined });
stub("src/utils/api/invite/generatePublicInviteController.ts", { getInviteFromProjectId: async () => ({}) });
stub("src/utils/controllers/projects/getAll.ts", { getProjectViewInclude: () => ({}) });
stub("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts", { getViewFromProject: () => undefined });
stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => ({ userId: 985 }) });
stub("src/utils/controllers/getMemberAndOwnerForBoard.ts", { default: async () => [985] });
stub("src/utils/api/Homepage/index.ts", { getProjectInviteURL: async () => ({}) });
const rqPath = require.resolve("@tanstack/react-query");
require.cache[rqPath] = { id: rqPath, filename: rqPath, loaded: true, exports: {
  useQuery: (options) => { queryOptions = options; return {}; },
} };

const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const handler = jiti(path.join(root, "src/pages/api/invite/generatePublicInvite.ts")).default;
const { useGetBoardInviteURL } = jiti(path.join(root, "src/hooks/Homepage/Invites/useGetBoardInviteURL.ts"));

function call(method, input) {
  return new Promise((resolve) => {
    const res = { status(code) { return { json: (body) => resolve({ code, body }) }; } };
    handler({ method, headers: {}, ...input }, res);
  });
}

test("invite link request without a board answers 400, not 500", async () => {
  projectLookups = 0;
  assert.equal((await call("GET", { query: { projectId: "undefined", userId: "985" } })).code, 400);
  assert.equal((await call("POST", { body: {} })).code, 400);
  assert.equal(projectLookups, 0);
});

test("invite link query does not run until a board and user are known", () => {
  useGetBoardInviteURL(undefined, 985);
  assert.equal(queryOptions.enabled, false);
  useGetBoardInviteURL(42, undefined);
  assert.equal(queryOptions.enabled, false);
  useGetBoardInviteURL(42, 985);
  assert.equal(queryOptions.enabled, true);
});
