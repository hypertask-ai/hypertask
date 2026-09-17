// HTPR-6544: firebase-admin 12.7.0 -> 14.4.0. v14 removed the namespaced
// default-import API (admin.app / admin.apps / admin.credential / admin.messaging),
// which is what made Dependabot's lockfile-only PR fail typecheck. This test
// pins 14.x and drives the real wrapper through the modular entry points so the
// next npm install cannot silently restore the old call sites.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScript(relativePath, stubs = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };

  new Function(
    "module",
    "exports",
    "require",
    "__filename",
    "__dirname",
    javascript,
  )(
    loadedModule,
    loadedModule.exports,
    (request) => stubs[request] ?? require(request),
    filename,
    path.dirname(filename),
  );

  return loadedModule.exports;
}

test("the installed firebase-admin is 14.x, and nothing pulls 12.x back in", () => {
  const installed = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules/firebase-admin/package.json"), "utf8"),
  ).version;
  assert.equal(
    Number(installed.split(".")[0]) >= 14,
    true,
    `firebase-admin ${installed} is installed; 12.x still has the namespaced API this bump exists to leave.`,
  );

  const declared = require(path.join(root, "package.json")).dependencies["firebase-admin"];
  assert.match(
    declared,
    /^\^?14\./,
    `package.json asks for firebase-admin "${declared}"; a range that still admits 12.x defeats the upgrade.`,
  );

  const lock = require(path.join(root, "package-lock.json"));
  const stale = Object.entries(lock.packages || {})
    .filter(([name, meta]) => /(^|\/)firebase-admin$/.test(name) && String(meta.version).startsWith("12."))
    .map(([name, meta]) => `${name}@${meta.version}`);
  assert.deepEqual(stale, [], "package-lock.json still resolves firebase-admin 12.x somewhere");
});

test("src no longer uses the v14-removed namespaced admin API", () => {
  const files = [
    "src/lib/firebase-admin.ts",
    "src/utils/controllers/FCM/index.ts",
  ];
  const banned = /\badmin\.(apps|app|credential|messaging)\b/;
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.equal(
      banned.test(source),
      false,
      `${relativePath} still uses a namespaced firebase-admin member that v14 deleted`,
    );
    assert.match(
      source,
      /from ["']firebase-admin\/(app|messaging|auth)["']/,
      `${relativePath} should import the modular firebase-admin entry points`,
    );
  }
});

function serviceAccountStub() {
  return {
    "@/lib/firebaseServiceAccount": {
      getFirebaseServiceAccount() {
        return {
          project_id: "demo-project",
          client_email: "admin@demo",
          private_key: "-----BEGIN PRIVATE KEY-----\\ndemo\\n-----END PRIVATE KEY-----\\n",
        };
      },
    },
  };
}

test("getFirebaseAdmin initializes through firebase-admin/app and getAuth uses firebase-admin/auth", () => {
  const app = { options: { projectId: "demo-project", credential: {} }, name: "[DEFAULT]" };
  const calls = { initializeApp: 0, cert: 0, getAuth: 0, getApp: 0 };
  const { getFirebaseAdmin, getAuth } = loadTypeScript("src/lib/firebase-admin.ts", {
    "firebase-admin/app": {
      cert(serviceAccount) {
        calls.cert += 1;
        assert.equal(serviceAccount.projectId, "demo-project");
        assert.equal(serviceAccount.clientEmail, "admin@demo");
        return { kind: "cert" };
      },
      getApp() {
        calls.getApp += 1;
        if (calls.initializeApp === 0) {
          throw new Error("default app missing");
        }
        return app;
      },
      initializeApp(options) {
        calls.initializeApp += 1;
        assert.equal(options.projectId, "demo-project");
        assert.deepEqual(options.credential, { kind: "cert" });
        return app;
      },
    },
    "firebase-admin/auth": {
      getAuth(passedApp) {
        calls.getAuth += 1;
        assert.equal(passedApp, app);
        return { verifyIdToken: async () => ({ uid: "user-1" }) };
      },
    },
    ...serviceAccountStub(),
  });

  assert.equal(getFirebaseAdmin(), app);
  assert.equal(getFirebaseAdmin(), app);
  const auth = getAuth();
  assert.equal(typeof auth.verifyIdToken, "function");
  assert.deepEqual(calls, { initializeApp: 1, cert: 1, getAuth: 1, getApp: 1 });
});

test("getFirebaseAdmin reuses a default app instead of treating any named app as enough", () => {
  const defaultApp = { options: { projectId: "demo-project", credential: {} }, name: "[DEFAULT]" };
  const calls = { initializeApp: 0, getApp: 0 };
  const { getFirebaseAdmin } = loadTypeScript("src/lib/firebase-admin.ts", {
    "firebase-admin/app": {
      cert() {
        throw new Error("cert should not run when the default app already exists");
      },
      getApp() {
        calls.getApp += 1;
        return defaultApp;
      },
      initializeApp() {
        calls.initializeApp += 1;
        throw new Error("initializeApp should not run when getApp succeeds");
      },
    },
    "firebase-admin/auth": {
      getAuth() {
        throw new Error("unused");
      },
    },
    ...serviceAccountStub(),
  });

  assert.equal(getFirebaseAdmin(), defaultApp);
  assert.deepEqual(calls, { initializeApp: 0, getApp: 1 });
});

test("getFirebaseAdmin recovers when initializeApp loses the already-exists race", () => {
  const defaultApp = { options: { projectId: "demo-project", credential: {} }, name: "[DEFAULT]" };
  const calls = { initializeApp: 0, getApp: 0 };
  const { getFirebaseAdmin } = loadTypeScript("src/lib/firebase-admin.ts", {
    "firebase-admin/app": {
      cert() {
        return { kind: "cert" };
      },
      getApp() {
        calls.getApp += 1;
        if (calls.initializeApp === 0) {
          throw new Error("default app missing");
        }
        return defaultApp;
      },
      initializeApp() {
        calls.initializeApp += 1;
        throw new Error("already exists");
      },
    },
    "firebase-admin/auth": {
      getAuth() {
        throw new Error("unused");
      },
    },
    ...serviceAccountStub(),
  });

  assert.equal(getFirebaseAdmin(), defaultApp);
  assert.deepEqual(calls, { initializeApp: 1, getApp: 2 });
});

test("FCM does not initialize Firebase while the module is loading", () => {
  const source = fs.readFileSync(
    path.join(root, "src/utils/controllers/FCM/index.ts"),
    "utf8",
  );
  assert.equal(
    /^\s*getFirebaseAdmin\(\);\s*$/m.test(source),
    false,
    "FCM must not call getFirebaseAdmin at import time; /api/tasks/single loads this module",
  );
  assert.match(source, /getMessaging\(getFirebaseAdmin\(\)\)/);
});
