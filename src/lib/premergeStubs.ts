type PremergeStub = "ai" | "queue";

export function premergeStubEnabled(stub: PremergeStub): boolean {
  const ai = process.env.HT_PREMERGE_AI_STUB === "1";
  const queue = process.env.HT_PREMERGE_QUEUE_STUB === "1";
  if (!ai && !queue) return false;

  let disposableDatabase = false;
  let disposableRedis = !queue;
  try {
    const database = new URL(process.env.DATABASE_URL ?? "");
    disposableDatabase =
      database.protocol === "postgresql:" &&
      database.hostname === "127.0.0.1" &&
      /^\d+$/.test(database.port) &&
      database.username === "browser_smoke" &&
      database.pathname === "/hypertask_smoke" &&
      !database.search &&
      !database.hash;
    if (queue) {
      const redis = new URL(process.env.REDIS_URL ?? "");
      disposableRedis = redis.protocol === "redis:" && redis.hostname === "127.0.0.1" &&
        /^\d+$/.test(redis.port) && !redis.search && !redis.hash;
    }
  } catch {
    // Do not include a connection string in the refusal message.
  }

  if (process.env.PREMERGE_LOCAL !== "1" || process.env.VERCEL ||
      process.env.VERCEL_ENV || !disposableDatabase || !disposableRedis) {
    throw new Error("Premerge stubs require the disposable local database and Redis and are forbidden on Vercel.");
  }
  return stub === "ai" ? ai : queue;
}
