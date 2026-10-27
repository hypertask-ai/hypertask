const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { Agent } = require("undici");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const safeFetch = load(path.join(root, "src/lib/mcp/attachments/safeFetch.ts"));
const fetchModule = load(path.join(root, "src/lib/net/fetchWithoutBrotli.ts"));
const filename = path.join(root, "src/lib/net/downloadWithoutBrotli.ts");
const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const status of [301, 302, 303, 307, 308, 300, 304]) {
  test(`AI download ${[300, 304].includes(status) ? "refuses" : "follows"} HTTP ${status} with Location`, async (t) => {
    const seen = [];
    const dispatchers = [];
    const guardedUrls = [];
    const server = http.createServer((request, response) => {
      seen.push(request.url);
      if (request.url === "/start") {
        response.writeHead(status, { location: "/landing" });
        return response.end();
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("download fixture");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const loaded = { exports: {} };
    vm.runInNewContext(code, {
      module: loaded, exports: loaded.exports, AbortSignal, URL, Uint8Array, Error, Promise,
      require: (id) => {
        if (id === "@/lib/net/fetchWithoutBrotli") return fetchModule;
        assert.equal(id, "@/lib/mcp/attachments/safeFetch");
        return { ...safeFetch, publicAddressDispatcher: async (url, signal) => {
          assert.ok(signal instanceof AbortSignal);
          guardedUrls.push(url.pathname);
          const dispatcher = new Agent();
          dispatchers.push(dispatcher);
          t.after(() => dispatcher.closed ? undefined : dispatcher.close());
          return dispatcher;
        } };
      },
    }, { filename });
    const url = new URL(`http://127.0.0.1:${server.address().port}/start`);
    if ([300, 304].includes(status)) {
      await assert.rejects(loaded.exports.downloadUntrustedUrl(url), new RegExp(`failed with HTTP ${status}`));
      assert.deepEqual(seen, ["/start"]);
    } else {
      const result = await loaded.exports.downloadUntrustedUrl(url);
      assert.equal(Buffer.from(result.data).toString(), "download fixture");
      assert.equal(result.mediaType, "text/plain");
      assert.deepEqual(seen, ["/start", "/landing"]);
    }
    assert.deepEqual(guardedUrls, seen);
    assert.ok(dispatchers.length > 0);
    assert.ok(dispatchers.every((dispatcher) => dispatcher.closed));
  });
}
