const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let authenticated;
let enabled;
let calls;
let handler;
function stub(file, exports) {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub("src/utils/edgeHelpers.ts", {
  isValidUser: () => ({ isValid: authenticated, user: authenticated ? { id: 6 } : null }),
});
stub("src/lib/flags.ts", { isFeatureEnabled: async () => enabled });
stub("node_modules/next/headers.js", {
  cookies: async () => ({ get: () => ({ value: "session" }) }),
});
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { GET } = jiti(path.join(root, "src/app/api/figma/oembed/route.ts"));

const KEY = "abcdefghijklmnopqrstuv";
const FIGMA = `https://www.figma.com/design/${KEY}/Preview`;
const COVER = {
  thumbnail_url: "https://s3-alpha.figma.com/cover.png",
  title: "Cover",
  width: 800,
  height: 450,
};
const json = (body, status = 200) => Response.json(body, { status });
const request = (url = FIGMA) =>
  new NextRequest(`https://app.test/api/figma/oembed?url=${encodeURIComponent(url)}`);
function reset() {
  authenticated = enabled = true;
  calls = [];
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  process.env.FIGMA_PREVIEW_FILE_KEYS = KEY;
  handler = (url) => {
    if (url.hostname === "www.figma.com") return json(COVER);
    throw new Error(`Unexpected fetch ${url}`);
  };
  global.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  };
}
test.beforeEach(reset);
test.after(() => {
  delete process.env.FIGMA_ACCESS_TOKEN;
  delete process.env.FIGMA_PREVIEW_FILE_KEYS;
});

test("authenticates and feature-gates token-backed previews", async () => {
  authenticated = false;
  assert.equal((await GET(request())).status, 401);
  assert.equal(calls.length, 0);

  reset();
  enabled = false;
  const response = await GET(request());
  const body = await response.json();
  assert.equal(calls.length, 1);
  assert.equal(body.thumbnailUrl, COVER.thumbnail_url);
  assert.match(response.headers.get("cache-control"), /s-maxage=3600/);
});

test("normalizes and renders only one requested node", async () => {
  handler = (url, init) => {
    if (url.hostname === "www.figma.com") return json(COVER);
    assert.equal(url.hostname, "api.figma.com");
    assert.equal(url.searchParams.get("ids"), "12:34");
    assert.equal(init.headers["X-Figma-Token"], "test-token");
    return json({ images: { "12:34": "https://s3-alpha.figma.com/frame.png" } });
  };
  const response = await GET(request(`${FIGMA}?node-id=12-34`));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await response.json()).previewImages, [
    { url: "https://s3-alpha.figma.com/frame.png", name: "Figma frame" },
  ]);

  reset();
  await GET(request(`${FIGMA}?node-id=12-34,56-78`));
  assert.equal(calls.length, 1);
});

test("renders at most six first-page frames and falls back on denial", async () => {
  const frames = Array.from({ length: 8 }, (_, i) => ({
    id: `${i + 1}:${i + 2}`,
    name: `Frame ${i + 1}`,
    type: "FRAME",
  }));
  handler = (url) => {
    if (url.hostname === "www.figma.com") return json(COVER);
    if (url.pathname.startsWith("/v1/files/")) {
      return json({ name: "File", document: { children: [{ children: frames }] } });
    }
    const ids = url.searchParams.get("ids").split(",");
    assert.deepEqual(ids, frames.slice(0, 6).map(({ id }) => id));
    return json({ images: Object.fromEntries(ids.map((id) => [id, `https://s3-alpha.figma.com/${id}`])) });
  };
  const body = await (await GET(request())).json();
  assert.deepEqual(body.previewImages.map(({ name }) => name), frames.slice(0, 6).map(({ name }) => name));

  reset();
  handler = (url) => (url.hostname === "www.figma.com" ? json(COVER) : json({}, 403));
  assert.equal((await (await GET(request(`${FIGMA}?node-id=1-2`))).json()).thumbnailUrl, COVER.thumbnail_url);
});
