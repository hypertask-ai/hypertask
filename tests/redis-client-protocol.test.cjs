// HTPR-6518: ioredis 6 opens every connection with HELLO 3 (RESP3) unless the
// client pins protocol: 2. Nothing else in the suite watches the wire, and the
// tests that talk to a real redis-server skip themselves on a runner without
// one, so the protocol our production client actually speaks was untested.
const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

// A RESP2-only Redis: it records every command it is asked for and answers
// HELLO the way an old server or a proxy without RESP3 does.
function startRecordingRedis() {
  const commands = [];
  const store = new Map();
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let parsed = parseCommand(buffer);
      while (parsed) {
        buffer = parsed.rest;
        commands.push(parsed.argv);
        socket.write(reply(parsed.argv, store));
        parsed = parseCommand(buffer);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        commands,
        url: `redis://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
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

  const consumed =
    lines.slice(0, argumentCount * 2 + 1).join("\r\n").length + 2;
  return { argv, rest: buffer.slice(consumed) };
}

function reply(argv, store) {
  const name = argv[0].toLowerCase();

  if (name === "hello") return "-ERR unknown command 'HELLO'\r\n";
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

test("the production Redis client speaks RESP2, not RESP3", async (t) => {
  const fake = await startRecordingRedis();
  const previousUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = fake.url;

  const jiti = createJiti(__filename, {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  const { getRedis } = jiti(path.join(root, "src/lib/redis.ts"));
  const client = await getRedis();

  t.after(async () => {
    client.disconnect();
    await fake.close();
    if (previousUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousUrl;
  });

  await client.set("htpr-6518", "resp2");
  assert.equal(await client.get("htpr-6518"), "resp2");

  const sent = fake.commands.map(([name]) => name.toLowerCase());
  assert.ok(
    !sent.includes("hello"),
    `client negotiated RESP3; commands sent were ${sent.join(", ")}`,
  );
  assert.equal(client.options.protocol, 2);
});
