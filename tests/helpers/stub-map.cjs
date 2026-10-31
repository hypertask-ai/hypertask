function enforcementFor(guard) {
  return {
    agentWritingPolicyEnabled: async () => true,
    enforceAgentWriting: async (_userId, ...writing) => guard.assertAgentWriting(...writing),
  }
}

function withStubs(base = {}, extra = {}) {
  const guard = base['@/lib/agents/writing']
  if (guard && !base['@/lib/agents/writingEnforcement']) {
    base = { ...base, '@/lib/agents/writingEnforcement': enforcementFor(guard) }
  }
  return new Proxy(Object.create(null), {
    has: (_target, request) => request in extra || request in base,
    get: (_target, request) => request in extra ? extra[request] : base[request],
  });
}

module.exports = { withStubs, enforcementFor };
