// Import-time stand-in for the Prisma client. Tests that exercise a writer
// pass their own transaction client, so nothing here is ever called.
const unavailable = () => {
  throw new Error("test stub: the real Prisma client is not available");
};

module.exports = {
  __esModule: true,
  default: new Proxy({}, { get: () => new Proxy({}, { get: () => unavailable }) }),
};
