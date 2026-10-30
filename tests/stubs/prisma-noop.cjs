const unavailable = () => {
  throw new Error("test stub: the real Prisma client is not available");
};

module.exports = {
  __esModule: true,
  default: new Proxy({}, { get: () => new Proxy({}, { get: () => unavailable }) }),
};
