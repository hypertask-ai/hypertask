const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

function startRedis({ dropFirstConnections, drop }) {
  const store = new Map();
  const sockets = new Set();
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    if (connections <= dropFirstConnections) {
      drop(socket);
      return;
    }
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let parsed = parseCommand(buffer);
      while (parsed) {
        buffer = parsed.rest;
        socket.write(reply(parsed.argv, store));
        parsed = parseCommand(buffer);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        connections: () => connections,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(done);
          }),
      });
    });
  });
}

function parseCommand(buffer) {
  if (!buffer.startsWith("*")) return null;
  const lines = buffer.split("\r\n");
  const argumentCount = Number(lines[0].slice(1));
  if (!Number.isInteger(argumentCount) || lines.length < argumentCount * 2 + 1) {
    return null;
  }
  const argv = [];
  for (let index = 0; index < argumentCount; index += 1) {
    argv.push(lines[2 + index * 2]);
  }
  const consumed = lines.slice(0, argumentCount * 2 + 1).join("\r\n").length + 2;
  return { argv, rest: buffer.slice(consumed) };
}

function reply(argv, store) {
  const name = argv[0].toLowerCase();
  if (name === "info") {
    const info = "# Server\r\nredis_version:7.0.15\r\n";
    return `$${Buffer.byteLength(info)}\r\n${info}\r\n`;
  }
  if (name === "set") {
    store.set(argv[1], argv[2]);
    return "+OK\r\n";
  }
  if (name === "get") {
    const value = store.get(argv[1]);
    if (value === undefined) return "$-1\r\n";
    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }
  return "+OK\r\n";
}

function captureConsole(t) {
  const lines = { error: [], warn: [] };
  for (const level of ["error", "warn"]) {
    const original = console[level];
    console[level] = (...args) => lines[level].push(args.map(String).join(" "));
    t.after(() => {
      console[level] = original;
    });
  }
  return lines;
}

async function freshRedisClient(t, url) {
  const previousUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = url;
  delete globalThis.redis;
  delete globalThis.redisPromise;
  const jiti = createJiti(__filename, {
    interopDefault: true,
    moduleCache: false,
    alias: { "@": path.join(root, "src") },
  });
  const { getRedis } = jiti(path.join(root, "src/lib/redis.ts"));
  const client = await getRedis();
  t.after(() => {
    client.disconnect();
    delete globalThis.redis;
    delete globalThis.redisPromise;
    if (previousUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousUrl;
  });
  return client;
}

async function waitFor(condition, what) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function unhandledIoredisErrors(lines) {
  return lines.error.filter((line) => line.includes("[ioredis] Unhandled error event"));
}

test("a TLS handshake cut short logs a warning, not an unhandled ioredis error", async (t) => {
  const redis = await startRedis({ dropFirstConnections: Infinity, drop: (socket) => socket.end() });
  t.after(redis.close);
  const lines = captureConsole(t);

  await freshRedisClient(t, `rediss://127.0.0.1:${redis.port}`);
  await waitFor(() => lines.warn.length > 0 || lines.error.length > 0, "a logged connection error");

  assert.deepEqual(unhandledIoredisErrors(lines), []);
  assert.match(
    lines.warn[0],
    /^\[redis\] connection error, reconnecting: .*Client network socket disconnected before secure TLS connection was established/,
  );
});

test("after a reset connection the shared client reconnects and serves commands", async (t) => {
  const redis = await startRedis({ dropFirstConnections: 1, drop: (socket) => socket.resetAndDestroy() });
  t.after(redis.close);
  const lines = captureConsole(t);

  const client = await freshRedisClient(t, `redis://127.0.0.1:${redis.port}`);
  await client.set("htpr-7366", "reconnected");

  assert.equal(await client.get("htpr-7366"), "reconnected");
  assert.ok(redis.connections() >= 2, "the client never reconnected after the reset");
  assert.deepEqual(unhandledIoredisErrors(lines), []);
  assert.match(lines.warn.join("\n"), /\[redis\] connection error, reconnecting: ECONNRESET/);
});
