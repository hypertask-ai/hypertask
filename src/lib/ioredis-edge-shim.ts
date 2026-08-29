export default class RedisEdgeShim {
  constructor() {
    throw new Error("ioredis cannot run in the Edge runtime.");
  }
}
