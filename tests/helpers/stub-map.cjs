function enforcementFor(guard) {
  return {
    agentWritingPolicyEnabled: async () => true,
    enforceAgentWriting: async (_userId, ...writing) => guard.assertAgentWriting(...writing),
  }
}

const plainLanguageTicketStubs = require("./plain-language-ticket-stubs.cjs");

function withStubs(base = {}, extra = {}) {
  const guard = base['@/lib/agents/writing']
  if (guard && !base['@/lib/agents/writingEnforcement']) {
    base = { ...base, '@/lib/agents/writingEnforcement': enforcementFor(guard) }
  }
  return new Proxy(Object.create(null), {
    has: (_target, request) => request in extra || request in base || request in plainLanguageTicketStubs,
    get: (_target, request) =>
      request in extra ? extra[request] : request in base ? base[request] : plainLanguageTicketStubs[request],
  });
}

module.exports = { withStubs, enforcementFor };
