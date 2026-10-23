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
    assert.match(lines[Number(lineNumber)] ?? "", /experimental_download: downloadWithoutBrotli,/, call);
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
