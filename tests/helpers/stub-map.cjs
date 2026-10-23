function withStubs(base = {}, extra = {}) {
  return new Proxy(Object.create(null), {
    has: (_target, request) => request in extra || request in base,
    get: (_target, request) => request in extra ? extra[request] : base[request],
  });
}

module.exports = { withStubs };
