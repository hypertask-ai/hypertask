const QUIET_PERSONAL_LOG = "@/utils/controllers/logs/quietPersonalLog"

function quietPersonalLogStub() {
  return {
    logPersonal: async (_userId, label, _ids, raw) => {
      if (raw !== undefined) console.log(label, raw)
    },
  }
}

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
  if (!(QUIET_PERSONAL_LOG in base) && !(QUIET_PERSONAL_LOG in extra)) {
    base = { ...base, [QUIET_PERSONAL_LOG]: quietPersonalLogStub() }
  }
  return new Proxy(Object.create(null), {
    has: (_target, request) => request in extra || request in base || request in plainLanguageTicketStubs,
    get: (_target, request) =>
      request in extra ? extra[request] : request in base ? base[request] : plainLanguageTicketStubs[request],
  });
}

module.exports = { withStubs, enforcementFor, quietPersonalLogStub };
