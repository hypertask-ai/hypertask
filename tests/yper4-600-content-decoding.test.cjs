const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { tmpdir } = require("node:os");
const { Agent } = require("undici");
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
    received.push({ origin: "other", authorization: request.headers.authorization, cookie: request.headers.cookie, proxyAuthorization: request.headers["proxy-authorization"], host: request.headers.host });
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
    received.push({ origin: "first", authorization: request.headers.authorization, cookie: request.headers.cookie, proxyAuthorization: request.headers["proxy-authorization"], host: request.headers.host });
    response.end(text);
  });
  try {
    const headers = { authorization: "Bearer fixture", cookie: "session=fixture", "proxy-authorization": "Basic fixture", host: "fixture.example" };
    const away = await fetchWithoutBrotli(`${first.base}/away`, { headers });
    assert.equal(await away.text(), text);
    assert.equal(away.redirected, true);
    const near = await fetchWithoutBrotli(`${first.base}/near`, { headers });
    assert.equal(await near.text(), text);
    assert.deepEqual(received, [
      { origin: "other", authorization: undefined, cookie: undefined, proxyAuthorization: undefined, host: new URL(other.base).host },
      { origin: "first", authorization: "Bearer fixture", cookie: "session=fixture", proxyAuthorization: "Basic fixture", host: "fixture.example" },
    ]);
  } finally {
    await new Promise((resolve) => other.server.close(resolve));
    await new Promise((resolve) => first.server.close(resolve));
  }
});

test("HTTPS downgrade drops credentials; same HTTPS origin still receives them", async (t) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "yper4-630-tls-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = path.join(directory, "key.pem");
  const cert = path.join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
    "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const seen = [];
  const handler = (request, response) => {
    seen.push({ url: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie });
    response.end(text);
  };
  const httpServer = http.createServer(handler);
  const httpsServer = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (request, response) => {
    if (request.url === "/away" || request.url === "/near") {
      response.writeHead(302, { location: request.url === "/away" ? `http://127.0.0.1:${server.address().port}/landing` : "/landing" });
      return response.end();
    }
    handler(request, response);
  });
  for (const listener of [httpServer, httpsServer]) {
    await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => { listener.closeAllConnections(); listener.close(resolve); }));
  }
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const listener = chunk[0] === 22 ? httpsServer : httpServer;
      const upstream = net.connect(listener.address().port, "127.0.0.1", () => {
        upstream.write(chunk);
        socket.pipe(upstream).pipe(socket);
      });
      socket.on("close", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dispatcher = new Agent({ connect: { ca: fs.readFileSync(cert) } });
  t.after(() => dispatcher.close());
  const base = `https://127.0.0.1:${server.address().port}`;
  const headers = { authorization: "Bearer fixture", cookie: "session=fixture" };
  for (const route of ["/away", "/near"]) {
    const response = await fetchWithoutBrotli(`${base}${route}`, { headers, dispatcher });
    assert.equal(await response.text(), text);
    assert.equal(response.redirected, true);
  }
  assert.deepEqual(seen, [
    { url: "/landing", authorization: undefined, cookie: undefined },
    { url: "/landing", authorization: "Bearer fixture", cookie: "session=fixture" },
  ]);
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
});
