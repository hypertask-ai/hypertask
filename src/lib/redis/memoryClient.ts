type Entry = { value: string; expiresAt: number | null };

function parseSetArgs(args: unknown[]): { ttlSeconds: number | null; nx: boolean } {
  let ttlSeconds: number | null = null;
  let nx = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index]).toUpperCase();
    if (token === "EX" && index + 1 < args.length) {
      ttlSeconds = Number(args[index + 1]);
      index += 1;
    } else if (token === "NX") {
      nx = true;
    }
  }
  return { ttlSeconds, nx };
}

function expired(entry: Entry | undefined): boolean {
  if (!entry) return true;
  if (entry.expiresAt === null) return false;
  return entry.expiresAt <= Date.now();
}

export type MemoryRedisClient = ReturnType<typeof createMemoryRedisClient>;

export function createMemoryRedisClient() {
  const strings = new Map<string, Entry>();
  const hashes = new Map<string, Map<string, string>>();

  const read = (key: string): string | null => {
    const entry = strings.get(key);
    if (!entry || expired(entry)) {
      strings.delete(key);
      return null;
    }
    return entry.value;
  };

  const write = (key: string, value: string, ttlSeconds: number | null) => {
    strings.set(key, {
      value,
      expiresAt: ttlSeconds === null ? null : Date.now() + ttlSeconds * 1000,
    });
  };

  const client = {
    options: { protocol: 2 as const },
    on() {
      return client;
    },
    disconnect() {},
    async get(key: string) {
      return read(key);
    },
    async getdel(key: string) {
      const value = read(key);
      strings.delete(key);
      return value;
    },
    async set(key: string, value: string, ...args: unknown[]) {
      const { ttlSeconds, nx } = parseSetArgs(args);
      if (nx && read(key) !== null) return null;
      write(key, String(value), ttlSeconds);
      return "OK";
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        if (strings.delete(key) || hashes.delete(key)) removed += 1;
      }
      return removed;
    },
    async incr(key: string) {
      const current = Number(read(key) ?? 0);
      const next = current + 1;
      write(key, String(next), null);
      return next;
    },
    async incrby(key: string, amount: number) {
      const current = Number(read(key) ?? 0);
      const next = current + amount;
      write(key, String(next), null);
      return next;
    },
    async mget(...keys: string[]) {
      return keys.map((key) => read(key));
    },
    async expire(key: string, seconds: number) {
      const entry = strings.get(key);
      if (!entry || expired(entry)) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
    async exists(...keys: string[]) {
      return keys.filter((key) => read(key) !== null).length;
    },
    multi() {
      const queued: Array<() => Promise<unknown>> = [];
      const chain = {
        incr(key: string) {
          queued.push(() => client.incr(key));
          return chain;
        },
        expire(key: string, seconds: number) {
          queued.push(() => client.expire(key, seconds));
          return chain;
        },
        async exec() {
          const results: Array<[null, unknown]> = [];
          for (const command of queued) {
            results.push([null, await command()]);
          }
          return results;
        },
      };
      return chain;
    },
    async hset(key: string, field: string, value: string) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key)!.set(field, value);
      return 1;
    },
    async hmget(key: string, ...fields: string[]) {
      const hash = hashes.get(key);
      return fields.map((field) => hash?.get(field) ?? null);
    },
    async eval(script: string, keyCount: number, ...args: unknown[]) {
      const keys = args.slice(0, keyCount).map(String);
      const argv = args.slice(keyCount).map(String);
      if (script.includes("redis.call('GET'") && script.includes("redis.call('SET'")) {
        const writers = read(keys[0]);
        const generation = read(keys[1]) ?? "0";
        const cached = read(keys[2]);
        if (writers && writers !== "0") return 0;
        if (cached) return 1;
        if (generation !== (argv[0] ?? "0")) return 0;
        write(keys[2], argv[1] ?? "", 30);
        return 1;
      }
      if (script.includes("redis.call('SET', KEYS[1]") && script.includes("INCR")) {
        write(keys[0], "1", 5);
        const generation = Number(read(keys[1]) ?? 0) + 1;
        write(keys[1], String(generation), null);
        strings.delete(keys[2]);
        return 1;
      }
      if (script.includes("cjson.decode")) {
        const incomingGeneration = Number(argv[0]);
        const incomingSequence = Number(argv[1]);
        const maxAdvance = Number(argv[4] ?? 1000);
        const currentRaw = read(keys[1]);
        if (currentRaw) {
          try {
            const decoded = JSON.parse(currentRaw) as { generation?: number; sequence?: number };
            const currentGeneration = Number(decoded.generation);
            const currentSequence = Number(decoded.sequence);
            if (currentGeneration > incomingGeneration
              || (currentGeneration === incomingGeneration && currentSequence >= incomingSequence)) {
              return [0, currentSequence + 1];
            }
            if ((currentGeneration === incomingGeneration && incomingSequence > currentSequence + maxAdvance)
              || (currentGeneration < incomingGeneration && incomingSequence > maxAdvance)) {
              return [-1, currentSequence + 1];
            }
          } catch {
          }
        } else if (incomingSequence > maxAdvance) {
          return [-1, 1];
        }
        write(keys[0], argv[2] ?? "", Number(argv[3] ?? 604800));
        write(keys[1], argv[5] ?? "", null);
        return [1, incomingSequence + 1];
      }
      if (script.includes("redis.call('DEL', KEYS[1]") && script.includes("redis.call('SET', KEYS[2]")) {
        strings.delete(keys[0]);
        write(keys[1], argv[0] ?? "", null);
        return 1;
      }
      if (script.includes('redis.call("INCR"')) {
        return client.incr(keys[0]);
      }
      if (script.includes('redis.call("exists"')) {
        const active = Number(argv[2] ?? 1);
        const setCount = Number(argv[3] ?? keys.length);
        if (keys.slice(0, active).some((key) => read(key) !== null)) return 0;
        if (keys.slice(setCount).some((key) => read(key) !== null)) return 0;
        for (const key of keys.slice(0, setCount)) write(key, argv[0] ?? "1", null);
        return 1;
      }
      if (script.includes('redis.call("del"')) {
        if (read(keys[0]) !== argv[0]) return 0;
        return Number(strings.delete(keys[0]));
      }
      if (script.includes('redis.call("GET"') && script.includes('redis.call("SET"')) {
        const expected = read(keys[0]);
        if (expected !== argv[0]) return 0;
        write(keys[0], argv[1] ?? expected ?? "", Number(argv[2] ?? 60));
        return 1;
      }
      throw new Error("Unsupported in-memory Redis script for agent traffic");
    },
  };
  return client;
}
