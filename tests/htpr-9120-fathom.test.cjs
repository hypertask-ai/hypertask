const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");
const config = require("../next.config.js");

const root = path.resolve(__dirname, "..");
const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));

async function headersFor(pathname) {
  const headers = {};
  for (const rule of await config.headers()) {
    if (!getPathMatch(rule.source)(pathname)) continue;
    for (const { key, value } of rule.headers) headers[key.toLowerCase()] = value;
  }
  return headers;
}

test("every page loads the Fathom tag from the shared head", () => {
  assert.match(head, /src="https:\/\/cdn\.usefathom\.com\/script\.js"/);
  assert.match(head, /data-site="SSBYTYUQ"/);
  assert.match(head, /\basync\b/);
});

test("the script policy allows Fathom on app routes", async () => {
  for (const pathname of ["/", "/login", "/project/15", "/detail/project-15/9120"]) {
    const policy = (await headersFor(pathname))["content-security-policy-report-only"];
    assert.match(policy, /script-src [^;]*https:\/\/cdn\.usefathom\.com/, pathname);
  }
});
