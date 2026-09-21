const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "../..");
const jiti = require("jiti")(path.join(root, "tests/api-auth-contract-jiti.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { isPublicApiPath } = jiti(path.join(root, "src/lib/api/authPolicy.ts"));
const {
  enforceApiBoundary,
  resetApiRateLimitsForTests,
} = jiti(path.join(root, "src/lib/api/proxyBoundary.ts"));

function walk(directory, predicate) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute, predicate);
    return predicate(absolute) ? [absolute] : [];
  });
}

function concreteSegment(segment) {
  if (segment.startsWith("[[...")) return "probe";
  if (segment.startsWith("[...")) return "probe";
  if (segment.startsWith("[")) return "1";
  return segment;
}

function routePath(file) {
  const appRoot = path.join(root, "src/app");
  if (file.startsWith(appRoot)) {
    return `/${path
      .relative(appRoot, path.dirname(file))
      .split(path.sep)
      .map(concreteSegment)
      .join("/")}`;
  }

  const pagesRoot = path.join(root, "src/pages");
  const relative = path.relative(pagesRoot, file).replace(/\.(?:ts|tsx)$/, "");
  const segments = relative.split(path.sep).map(concreteSegment);
  if (segments.at(-1) === "index") segments.pop();
  return `/${segments.join("/")}`;
}

const routeFiles = [
  ...walk(path.join(root, "src/app/api"), (file) => file.endsWith(`${path.sep}route.ts`)),
  ...walk(
    path.join(root, "src/pages/api"),
    (file) => file.endsWith(".ts") || file.endsWith(".tsx"),
  ),
];

test("every protected API route rejects a request with no session", () => {
  resetApiRateLimitsForTests();
  assert.ok(routeFiles.length > 400, "route discovery must cover both API routers");

  for (const [index, file] of routeFiles.entries()) {
    const pathname = routePath(file);
    if (isPublicApiPath(pathname)) continue;
    const request = new NextRequest(`https://example.test${pathname}`, {
      headers: { "x-forwarded-for": `contract-${index}` },
    });
    const response = enforceApiBoundary(request);
    assert.equal(response?.status, 401, `${pathname} must reject a missing session`);
  }
});

test("public API routes pass the shared session gate", () => {
  resetApiRateLimitsForTests();
  const publicRoutes = routeFiles.map(routePath).filter(isPublicApiPath);
  assert.ok(publicRoutes.length > 20, "the public route allowlist must be exercised");

  for (const [index, pathname] of publicRoutes.entries()) {
    const request = new NextRequest(`https://example.test${pathname}`, {
      headers: { "x-forwarded-for": `public-${index}` },
    });
    assert.equal(enforceApiBoundary(request), null, pathname);
  }
});

test("the shared API boundary rate limits repeated callers", () => {
  resetApiRateLimitsForTests();
  const request = () =>
    new NextRequest("https://example.test/api/version", {
      headers: { "x-forwarded-for": "rate-limit-contract" },
    });

  for (let index = 0; index < 600; index += 1) {
    assert.equal(enforceApiBoundary(request()), null);
  }
  assert.equal(enforceApiBoundary(request())?.status, 429);
});
