const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/lib/auth/accounts.ts"),
  "utf8",
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadAccountsModule(authClient, options = {}) {
  const assignedPaths = [];
  const cookieWrites = [];
  const cookieDeletes = [];
  const cookies = options.cookies ?? {};
  const previousWindow = global.window;

  global.window = {
    location: {
      assign: (value) => assignedPaths.push(value),
    },
  };

  const accountModule = { exports: {} };
  const mockRequire = (request) => {
    if (request === "nookies") {
      return {
        __esModule: true,
        default: {
          destroy: (...args) => cookieDeletes.push(args),
          set: (...args) => cookieWrites.push(args),
        },
        parseCookies: () => cookies,
      };
    }
    if (request === "@/lib/configs/auth.config") {
      return {
        __esModule: true,
        default: {
          cookies: { options: { path: "/" }, user: "nookies_user" },
        },
      };
    }
    if (request === "@/lib/auth/betterAuthClient") {
      return { authClient };
    }
    throw new Error(`Unexpected import: ${request}`);
  };

  new Function("module", "exports", "require", javascript)(
    accountModule,
    accountModule.exports,
    mockRequire,
  );

  return {
    ...accountModule.exports,
    assignedPaths,
    cookieDeletes,
    cookieWrites,
    restore: () => {
      global.window = previousWindow;
    },
  };
}

const baseClient = (overrides = {}) => ({
  getSession:
    overrides.getSession ??
    (async () => ({ data: { session: { token: "current-token" } } })),
  multiSession: {
    listDeviceSessions: async () => ({ data: [] }),
    revoke: async () => ({ data: { status: true } }),
    setActive: async () => ({ data: {} }),
    ...overrides.multiSession,
  },
  signOut:
    overrides.signOut ?? (async () => ({ data: { success: true } })),
});

test("listAccounts maps valid Better Auth device sessions", async (t) => {
  const authClient = baseClient({
    multiSession: {
      listDeviceSessions: async () => ({
        data: [
          {
            session: { token: "session-one" },
            user: {
              id: "42",
              email: "first@example.com",
              image: "avatar.png",
              name: "First",
            },
          },
          { session: { token: "missing-user" }, user: null },
          {
            session: { token: "bad-id" },
            user: { id: "not-a-number", email: "bad@example.com" },
          },
        ],
      }),
    },
  });
  const accounts = loadAccountsModule(authClient);
  t.after(accounts.restore);

  assert.deepEqual(await accounts.listAccounts(), [
    {
      sessionToken: "session-one",
      id: 42,
      email: "first@example.com",
      name: "First",
      image: "avatar.png",
    },
  ]);
});

test("switchAccount reloads only after Better Auth activates the session", async (t) => {
  const calls = [];
  const authClient = baseClient({
    multiSession: {
      setActive: async ({ sessionToken }) => {
        calls.push(sessionToken);
        return { data: {} };
      },
    },
  });
  const accounts = loadAccountsModule(authClient);
  t.after(accounts.restore);

  assert.equal(await accounts.switchAccount("next-token"), true);
  assert.deepEqual(calls, ["next-token"]);
  assert.deepEqual(accounts.assignedPaths, ["/inbox"]);
});

test("switchAccount reports an expired session without navigating", async (t) => {
  const authClient = baseClient({
    multiSession: {
      setActive: async () => ({ error: { message: "expired" } }),
    },
  });
  const accounts = loadAccountsModule(authClient);
  t.after(accounts.restore);

  assert.equal(await accounts.switchAccount("expired-token"), false);
  assert.deepEqual(accounts.assignedPaths, []);
});

test("removeAccount revokes only the selected device session", async (t) => {
  const revoked = [];
  const authClient = baseClient({
    multiSession: {
      revoke: async ({ sessionToken }) => {
        revoked.push(sessionToken);
        return { data: { status: true } };
      },
    },
  });
  const accounts = loadAccountsModule(authClient);
  t.after(accounts.restore);

  assert.equal(await accounts.removeAccount("remove-token"), true);
  assert.deepEqual(revoked, ["remove-token"]);
});

test("current-account sign-out switches, revokes only the old session, then reloads", async (t) => {
  const calls = [];
  const authClient = baseClient({
    getSession: async () => ({
      data: { session: { token: "current-token" } },
    }),
    multiSession: {
      setActive: async ({ sessionToken }) => {
        calls.push(["activate", sessionToken]);
        return { data: {} };
      },
      revoke: async ({ sessionToken }) => {
        calls.push(["revoke", sessionToken]);
        return { data: { status: true } };
      },
    },
  });
  const accounts = loadAccountsModule(authClient);
  t.after(accounts.restore);

  assert.equal(await accounts.signOutCurrentAccount("next-token"), true);
  assert.deepEqual(calls, [
    ["activate", "next-token"],
    ["revoke", "current-token"],
  ]);
  assert.deepEqual(accounts.assignedPaths, ["/inbox"]);
});

test("current-account sign-out restores the old identity when revocation fails", async (t) => {
  const activated = [];
  const authClient = baseClient({
    multiSession: {
      setActive: async ({ sessionToken }) => {
        activated.push(sessionToken);
        return { data: {} };
      },
      revoke: async () => ({ error: { message: "failed" } }),
    },
  });
  const accounts = loadAccountsModule(authClient);
  t.after(accounts.restore);

  assert.equal(await accounts.signOutCurrentAccount("next-token"), false);
  assert.deepEqual(activated, ["next-token", "current-token"]);
  assert.deepEqual(accounts.assignedPaths, []);
});

test("all-account sign-out uses Better Auth's full multi-session logout", async (t) => {
  let signOutCalls = 0;
  const authClient = baseClient({
    signOut: async () => {
      signOutCalls += 1;
      return { data: { success: true } };
    },
  });
  const accounts = loadAccountsModule(authClient);
  t.after(accounts.restore);

  assert.equal(await accounts.signOutAllAccounts(), true);
  assert.equal(signOutCalls, 1);
});

test("both generic sign-out surfaces use the multi-account confirmation", () => {
  const commandSource = fs.readFileSync(
    path.join(__dirname, "../src/components/commands.tsx"),
    "utf8",
  );
  const sidebarSource = fs.readFileSync(
    path.join(
      __dirname,
      "../src/components/sidebars/RightSidebar/Signout.tsx",
    ),
    "utf8",
  );
  const modalSource = fs.readFileSync(
    path.join(
      __dirname,
      "../src/components/Modals/SignOut/SignOutModal.tsx",
    ),
    "utf8",
  );

  assert.match(commandSource, /CommandMode\.Logout[\s\S]*?<SignOutModal/);
  assert.match(sidebarSource, /<SignOutModal/);
  assert.match(modalSource, /Sign out of all accounts/);
  assert.match(modalSource, /You’ll switch to/);
});
