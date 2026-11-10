type Entry = { value: string; expiresAt: number | null };

function parseSetArgs(args: unknown[]): { ttlSeconds: number | null; nx: boolean } {
  let ttlSeconds: number | null = null;
  let nx = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index]).toUpperCase();
    if (token === "EX" && index + 1 < args.length) {
      ttlSeconds = Number(args[index + 1]);
      index += 1;
    } else if (token === "NX") nx = true;
  }
  return { ttlSeconds, nx };
}

function expired(entry: Entry | undefined): boolean {
  if (!entry) return true;
  if (entry.expiresAt === null) return false;
  return entry.expiresAt <= Date.now();
}

export function createMemoryRedisClient() {
  const strings = new Map<string, Entry>();
  const hashes = new Map<string, Map<string, string>>();

  const read = (key: string) => {
    const entry = strings.get(key);
    if (!entry || expired(entry)) {
      strings.delete(key);
      return null;
    }
    return entry.value;
  };

  const write = (key: string, value: string, ttlSeconds: number | null) => {
    strings.set(key, { value, expiresAt: ttlSeconds === null ? null : Date.now() + ttlSeconds * 1000 });
  };

  const client = {
    options: { protocol: 2 as const },
    on() { return client; },
    disconnect() {},
    get: async (key: string) => read(key),
    getdel: async (key: string) => { const value = read(key); strings.delete(key); return value; },
    set: async (key: string, value: string, ...args: unknown[]) => {
      const { ttlSeconds, nx } = parseSetArgs(args);
      if (nx && read(key) !== null) return null;
      write(key, String(value), ttlSeconds);
      return "OK";
    },
    del: async (...keys: string[]) => keys.reduce((removed, key) => removed + (strings.delete(key) || hashes.delete(key) ? 1 : 0), 0),
    incr: async (key: string) => { const next = Number(read(key) ?? 0) + 1; write(key, String(next), null); return next; },
    incrby: async (key: string, amount: number) => { const next = Number(read(key) ?? 0) + amount; write(key, String(next), null); return next; },
    decrby: async (key: string, amount: number) => client.incrby(key, -amount),
    mget: async (...keys: string[]) => keys.map((key) => read(key)),
    expire: async (key: string, seconds: number) => {
      const entry = strings.get(key);
      if (!entry || expired(entry)) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
    exists: async (...keys: string[]) => keys.filter((key) => read(key) !== null).length,
    hset: async (key: string, field: string, value: string) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key)!.set(field, value);
      return 1;
    },
    hmget: async (key: string, ...fields: string[]) => fields.map((field) => hashes.get(key)?.get(field) ?? null),
    hincrby: async (key: string, field: string, amount: number) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      const hash = hashes.get(key)!;
      const next = Number(hash.get(field) ?? 0) + amount;
      hash.set(field, String(next));
      return next;
    },
    hgetall: async (key: string) => Object.fromEntries(hashes.get(key) ?? []),
    multi() {
      const queued: Array<() => Promise<unknown>> = [];
      const chain = {
        incr(key: string) { queued.push(() => client.incr(key)); return chain; },
        expire(key: string, seconds: number) { queued.push(() => client.expire(key, seconds)); return chain; },
        async exec() { return queued.map((command) => [null, command()]); },
      };
      return chain;
    },
    eval: async (script: string, keyCount: number, ...args: unknown[]) => {
      const keys = args.slice(0, keyCount).map(String);
      const argv = args.slice(keyCount).map(String);
      if (script.includes("redis.call('SET', KEYS[1]") && script.includes("INCR")) {
        write(keys[0], "1", 5);
        write(keys[1], String(Number(read(keys[1]) ?? 0) + 1), null);
        strings.delete(keys[2]);
        return 1;
      }
      if (script.includes('redis.call("INCR"') || script.includes("redis.call('INCR'")) return client.incr(keys[0]);
      if (script.includes('redis.call("exists"')) {
        const active = Number(argv[2] ?? 1);
        const setCount = Number(argv[3] ?? keys.length);
        if (keys.slice(0, active).some((key) => read(key) !== null)) return 0;
        if (keys.slice(setCount).some((key) => read(key) !== null)) return 0;
        keys.slice(0, setCount).forEach((key) => write(key, argv[0] ?? "1", null));
        return 1;
      }
      if (script.includes('redis.call("del"') || script.includes("redis.call('DEL'")) {
        if (argv[0] && read(keys[0]) !== argv[0]) return 0;
        return Number(strings.delete(keys[0]));
      }
      throw new Error("Unsupported in-memory Redis script for agent traffic");
    },
  };
  return client;
}
