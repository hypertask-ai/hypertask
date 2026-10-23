const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const { fetchWithoutBrotli, RefusedContentEncodingError, UNTRUSTED_ACCEPT_ENCODING } = load(path.join(root, "src/lib/net/fetchWithoutBrotli.ts"));
const { refusedContentEncoding } = load(path.join(root, "src/lib/net/contentEncoding.ts"));

const text = "Fixture document body";

async function withServer(run) {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push({ url: request.url, acceptEncoding: request.headers["accept-encoding"] });
    if (request.url === "/br") {
      response.writeHead(200, { "content-type": "text/plain", "content-encoding": "br" });
      response.end(zlib.brotliCompressSync(Buffer.from(text)));
    } else if (request.url === "/gzip") {
      response.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      response.end(zlib.gzipSync(Buffer.from(text)));
    } else if (request.url === "/deflate") {
      response.writeHead(200, { "content-type": "text/plain", "content-encoding": "deflate" });
      response.end(zlib.deflateSync(Buffer.from(text)));
    } else if (request.url === "/redirect-to-br") {
      response.writeHead(302, { location: "/br" });
      response.end();
    } else if (request.url === "/redirect") {
      response.writeHead(302, { location: "/plain" });
      response.end();
    } else {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(text);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, seen);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("now refused: a Brotli response is rejected before its body is read", async () => {
  await withServer(async (base) => {
    await assert.rejects(() => fetchWithoutBrotli(`${base}/br`), RefusedContentEncodingError);
    await assert.rejects(() => fetchWithoutBrotli(`${base}/redirect-to-br`), RefusedContentEncodingError);
  });
});

test("still allowed: plain, gzip and deflate responses read as before, and requests never offer br", async () => {
  await withServer(async (base, seen) => {
    for (const route of ["/plain", "/gzip", "/deflate", "/redirect"]) {
      const response = await fetchWithoutBrotli(`${base}${route}`);
      assert.equal(response.status, 200, route);
      assert.equal(await response.text(), text, route);
    }
    const manual = await fetchWithoutBrotli(`${base}/redirect`, { redirect: "manual" });
    assert.equal(manual.status, 302);
    assert.equal(manual.headers.get("location"), "/plain");
    assert.ok(seen.length > 0);
    for (const request of seen) {
      assert.equal(request.acceptEncoding, UNTRUSTED_ACCEPT_ENCODING);
      assert.doesNotMatch(request.acceptEncoding, /br/);
    }
  });
});

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("now refused: credentials do not follow a redirect to another origin; still allowed on the same origin", async () => {
  const received = [];
  const other = await listen((request, response) => {
    received.push({ origin: "other", authorization: request.headers.authorization, cookie: request.headers.cookie });
    response.end(text);
  });
  const first = await listen((request, response) => {
    if (request.url === "/away") {
      response.writeHead(302, { location: `${other.base}/landing` });
      return response.end();
    }
    if (request.url === "/near") {
      response.writeHead(307, { location: "/landing" });
      return response.end();
    }
    received.push({ origin: "first", authorization: request.headers.authorization, cookie: request.headers.cookie });
    response.end(text);
  });
  try {
    const headers = { authorization: "Bearer fixture", cookie: "session=fixture" };
    const away = await fetchWithoutBrotli(`${first.base}/away`, { headers });
    assert.equal(await away.text(), text);
    assert.equal(away.redirected, true);
    const near = await fetchWithoutBrotli(`${first.base}/near`, { headers });
    assert.equal(await near.text(), text);
    assert.deepEqual(received, [
      { origin: "other", authorization: undefined, cookie: undefined },
      { origin: "first", authorization: "Bearer fixture", cookie: "session=fixture" },
    ]);
  } finally {
    await new Promise((resolve) => other.server.close(resolve));
    await new Promise((resolve) => first.server.close(resolve));
  }
});

test("a 303 keeps HEAD as HEAD and a 205 has no body", async () => {
  const methods = [];
  const { server, base } = await listen((request, response) => {
    methods.push(`${request.method} ${request.url}`);
    if (request.url === "/see-other") {
      response.writeHead(303, { location: "/reset" });
      return response.end();
    }
    response.writeHead(205);
    response.end();
  });
  try {
    const head = await fetchWithoutBrotli(`${base}/see-other`, { method: "HEAD" });
    assert.equal(head.status, 205);
    const post = await fetchWithoutBrotli(`${base}/see-other`, { method: "POST", body: "x" });
    assert.equal(post.status, 205);
    assert.equal(await post.text(), "");
    assert.deepEqual(methods, ["HEAD /see-other", "HEAD /reset", "POST /see-other", "GET /reset"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("now refused: more than five stacked encodings; still allowed: five", () => {
  assert.ok(refusedContentEncoding(Array(6).fill("gzip").join(", ")));
  assert.equal(refusedContentEncoding(Array(5).fill("gzip").join(", ")), undefined);
});

test("inbound: Brotli or unknown request encodings are refused, gzip, deflate and identity still pass", () => {
  assert.equal(refusedContentEncoding("br"), "br");
  assert.equal(refusedContentEncoding("gzip, br"), "br");
  assert.equal(refusedContentEncoding("zstd"), "zstd");
  for (const allowed of [null, undefined, "", "identity", "gzip", "deflate", "GZIP"]) {
    assert.equal(refusedContentEncoding(allowed), undefined, String(allowed));
  }
  const proxy = fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8");
  const entry = proxy.slice(proxy.indexOf("export default async function requireAuthMiddleware"));
  assert.match(entry, /^[^\n]*\n\s*const refusedEncoding = refusedContentEncoding\(request\.headers\.get\('content-encoding'\)\);\n\s*if \(refusedEncoding\) \{\n\s*return NextResponse\.json\([\s\S]{0,200}status: 415/);
});

test("no source decodes Brotli directly", () => {
  const grep = (pattern) => {
    try {
      return execFileSync("git", ["grep", "-n", "-E", pattern, "--", "src"], { cwd: root, encoding: "utf8" }).trim();
    } catch (error) {
      if (error.status === 1) return "";
      throw error;
    }
  };
  assert.equal(grep("brotliDecompress|BrotliDecompress"), "");
  assert.notEqual(grep("createGunzip"), "", "the grep itself finds a known decoder");
});

test("every AI generation call passes the Brotli-free download", () => {
  const calls = execFileSync("git", ["grep", "-n", "-E", "\\b(streamText|generateText)\\(\\{", "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter((line) => line && !line.includes(".test."));
  assert.ok(calls.length > 10);
  for (const call of calls) {
    const [file, lineNumber] = call.split(":");
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
    const firstOptions = lines.slice(Number(lineNumber), Number(lineNumber) + 2).join("\n");
    assert.match(firstOptions, /experimental_download: downloadWithoutBrotli,/, call);
  }
});

test("modules that download user-chosen URLs never call the auto-decoding global fetch", () => {
  for (const file of [
    "src/lib/mcp/attachments/safeFetch.ts",
    "src/lib/net/downloadWithoutBrotli.ts",
    "src/app/api/ai/_lib/customInstructions.ts",
    "src/app/api/settings/byok-test/route.ts",
    "src/lib/mcp/webhooks/delivery.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /(?<![\w.])fetch\(/, file);
  }
  const modelProvider = fs.readFileSync(path.join(root, "src/app/api/ai/_lib/modelProvider.ts"), "utf8");
  assert.match(modelProvider, /baseURL: customEndpoint\.baseUrl,\s*fetch: fetchWithoutBrotli,/);
});
