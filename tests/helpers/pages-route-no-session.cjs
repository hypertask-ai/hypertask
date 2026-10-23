// Calls a Pages API route with no session and records status and body.
// Prisma and next/headers are stubbed the same way as tests/api-no-login.test.cjs,
// so a route that reaches the database before its auth check throws PRISMA_TOUCHED.
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

function createHarness(root) {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "ht-6992-no-session-"));
  const prismaStubPath = path.join(stubDir, "prisma-stub.cjs");
  const headersStubPath = path.join(stubDir, "headers-stub.cjs");
  fs.writeFileSync(prismaStubPath, `
const touches = []
function make(label) {
  const fn = function prismaStub() {}
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      if (prop === 'constructor' || prop === 'prototype' || prop === 'name' || prop === 'length') return undefined
      touches.push(label + '.' + String(prop))
      return make(label + '.' + String(prop))
    },
    apply() { const e = new Error('PRISMA_TOUCHED ' + label); e.code = 'PRISMA_TOUCHED'; throw e },
    construct() { const e = new Error('PRISMA_TOUCHED new ' + label); e.code = 'PRISMA_TOUCHED'; throw e },
  })
}
module.exports = { __esModule: true, default: make('prisma'), __touches: touches, __reset() { touches.length = 0 } }
`);
  fs.writeFileSync(headersStubPath, `
function store() { return { get() {}, getAll() { return [] }, has() { return false }, set() {}, delete() {} } }
module.exports = {
  cookies: async () => store(),
  headers: async () => new Headers(),
  draftMode: async () => ({ isEnabled: false, enable() {}, disable() {} }),
}
`);

  const isPrisma = (value) => {
    const v = String(value).replace(/\\/g, "/");
    return v === "@/lib/prisma" || v === "@/lib/prisma.ts" || v.endsWith("/src/lib/prisma.ts") || v.endsWith("/src/lib/prisma.js");
  };
  const isHeaders = (value) => {
    const v = String(value).replace(/\\/g, "/");
    return v === "next/headers" || v.endsWith("/next/headers.js");
  };
  const rewrite = (file, data, options) => {
    if (typeof file !== "string" || !file.includes("/src/") || !/\.(?:ts|tsx|js|mjs|cjs)$/.test(file)) return data;
    const encoding = typeof options === "string" ? options : options && options.encoding;
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    if (!text.includes("lib/prisma") && !text.includes("next/headers")) return data;
    const out = text
      .replace(/(['"])@\/lib\/prisma(?:\.ts)?\1/g, `'${prismaStubPath}'`)
      .replace(/(['"])next\/headers\1/g, `'${headersStubPath}'`)
      .replace(/(['"])(?:\.\.\/)+lib\/prisma(?:\.ts)?\1/g, `'${prismaStubPath}'`);
    if (out === text) return data;
    return Buffer.isBuffer(data) && !encoding ? Buffer.from(out) : out;
  };
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function patched(file, options) {
    return rewrite(file, readFileSync.apply(this, arguments), options);
  };
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function patched(request, parent, isMain, options) {
    if (isHeaders(request)) return headersStubPath;
    if (isPrisma(request)) return prismaStubPath;
    const resolved = resolve.call(this, request, parent, isMain, options);
    if (isHeaders(resolved)) return headersStubPath;
    if (isPrisma(resolved)) return prismaStubPath;
    return resolved;
  };

  const prismaStub = require(prismaStubPath);
  const jiti = require("jiti")(path.join(root, "tests/helpers/pages-route-no-session.cjs"), {
    interopDefault: true,
    fsCache: false,
    alias: { "@": path.join(root, "src") },
  });

  function load(file) {
    const loaded = jiti(path.join(root, file));
    return typeof loaded === "function" ? loaded : loaded.default;
  }

  async function call(handler, method, body = {}) {
    prismaStub.__reset();
    let status = null;
    let payload;
    let ended = false;
    const res = {
      get statusCode() { return status ?? 200; },
      set statusCode(value) { status = value; },
      headersSent: false,
      setHeader() { return res; },
      getHeader() { return undefined; },
      removeHeader() {},
      status(code) { status = code; return res; },
      json(value) { ended = true; payload = value === undefined ? undefined : JSON.parse(JSON.stringify(value)); return res; },
      send(value) { ended = true; payload = value; return res; },
      end() { ended = true; return res; },
      write() { return true; },
    };
    const req = {
      method,
      headers: {},
      cookies: {},
      query: {},
      body,
      url: "/",
      socket: { remoteAddress: "127.0.0.1" },
      connection: { remoteAddress: "127.0.0.1" },
    };
    try {
      await Promise.race([
        Promise.resolve().then(() => handler(req, res)),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("HANDLER_TIMEOUT"), { code: "HANDLER_TIMEOUT" })), 1500).unref()),
      ]);
    } catch (error) {
      return { status: error.code === "HANDLER_TIMEOUT" ? "timeout" : "throw", body: String(error.code || error.message), prismaTouched: prismaStub.__touches.length > 0 };
    }
    if (!ended) return { status: "no-response", prismaTouched: prismaStub.__touches.length > 0 };
    return { status: status ?? 200, body: payload, prismaTouched: prismaStub.__touches.length > 0 };
  }

  return { load, call };
}

module.exports = { createHarness };
