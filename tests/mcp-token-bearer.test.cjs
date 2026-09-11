const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const utilsPath = path.join(root, "src/lib/mcp/bearerAuth.ts");

function loadUtilsViaStripTypes() {
  const script = `
    import {
      MCP_TOKEN_MASK,
      isUsableMcpBearerToken,
      mcpAuthorizationHeaders,
      readMcpTokenCookieValue,
    } from ${JSON.stringify(pathToFileURL(utilsPath).href)};
    const cases = {
      nullish: isUsableMcpBearerToken(null),
      empty: isUsableMcpBearerToken(""),
      mask: isUsableMcpBearerToken(MCP_TOKEN_MASK),
      stars: isUsableMcpBearerToken("***"),
      jwt: isUsableMcpBearerToken("header.payload.signature"),
      maskHeaders: mcpAuthorizationHeaders("***"),
      jwtHeaders: mcpAuthorizationHeaders("header.payload.signature"),
      pad: readMcpTokenCookieValue("mcp_token=aaa.bbb.ccc=; path=/"),
      mid: readMcpTokenCookieValue("foo=1; mcp_token=aaa.bbb.ccc=; bar=2"),
      miss: readMcpTokenCookieValue("session=abc"),
      maskConst: MCP_TOKEN_MASK,
    };
    process.stdout.write(JSON.stringify(cases));
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || "strip-types import failed");
  return JSON.parse(result.stdout);
}

test("masked MCP token is not a usable Authorization bearer", () => {
  const cases = loadUtilsViaStripTypes();
  assert.equal(cases.nullish, false);
  assert.equal(cases.empty, false);
  assert.equal(cases.mask, false);
  assert.equal(cases.stars, false);
  assert.equal(cases.jwt, true);
  assert.equal(cases.maskConst, "***");
  assert.deepEqual(cases.maskHeaders, {});
  assert.equal(Object.keys(cases.jwtHeaders).join(","), "Authorization");
  assert.equal(
    cases.jwtHeaders.Authorization.startsWith("Bearer "),
    true,
  );
  assert.equal(
    cases.jwtHeaders.Authorization.slice("Bearer ".length),
    "header.payload.signature",
  );
});

test("mcp_token cookie parse keeps JWT padding after equals signs", () => {
  const cases = loadUtilsViaStripTypes();
  assert.equal(cases.pad, "aaa.bbb.ccc=");
  assert.equal(cases.mid, "aaa.bbb.ccc=");
  assert.equal(cases.miss, null);
});

test("useMcpToken reads cookies through readMcpTokenCookieValue", () => {
  const hook = fs.readFileSync(
    path.join(root, "src/components/Modals/McpToken/hooks/useMcpToken.ts"),
    "utf8",
  );
  assert.match(hook, /readMcpTokenCookieValue\(document\.cookie\)/);
  assert.doesNotMatch(hook, /tokenCookie\.split\("="\)\[1\]/);
  assert.match(hook, /MCP_TOKEN_MASK/);
});
