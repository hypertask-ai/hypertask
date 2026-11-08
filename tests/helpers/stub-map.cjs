const QUIET_PERSONAL_LOG = "@/utils/controllers/logs/quietPersonalLog"

function recordId(value) {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (value && typeof value === "object" && "id" in value) {
    const id = value.id
    if (typeof id === "string" || typeof id === "number") return String(id)
  }
  return null
}

function quietPersonalLogStub() {
  return {
    recordId,
    logPersonal: async (_userId, label, _ids, raw) => {
      if (raw !== undefined) console.log(label, raw)
    },
  }
}

function enforcementFor(guard) {
  return {
    agentWritingPolicyEnabled: async () => true,
    peopleCommentWholeCheckEnabled: async () => false,
    enforceAgentWriting: async (_userId, ...writing) => guard.assertAgentWriting(...writing),
  }
}

const plainLanguageTicketStubs = require("./plain-language-ticket-stubs.cjs");

const emailStraightBoardStubs = {
  "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
  "@/utils/controllers/users/findUserByEmail": { findUserByEmail: async () => null },
  "@/lib/flags/definitions/htpr-7553-email-straight-board": { HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG: "htpr-7553-email-straight-board" },
  "@/lib/auth/unverifiedEmailAccount": {
    unverifiedEmailAccount: async () => "allowed",
  },
  "@/lib/auth/emailStraightBoard": {
    finishStraightBoardEmailSignup: async () => ({ ok: false }),
    sendSignupVerificationEmail: async () => {},
  },
};

const straightBoardGuardStubs = {
  "@/lib/auth/unverifiedEmailAccount": {
    unverifiedEmailAccount: async () => "allowed",
  },
};

function withStubs(base = {}, extra = {}) {
  const guard = base['@/lib/agents/writing']
  if (guard && !base['@/lib/agents/writingEnforcement']) {
    base = { ...base, '@/lib/agents/writingEnforcement': enforcementFor(guard) }
  }
  const defaults = Object.create(null)
  if (!(QUIET_PERSONAL_LOG in base) && !(QUIET_PERSONAL_LOG in extra)) {
    defaults[QUIET_PERSONAL_LOG] = quietPersonalLogStub()
  }
  return new Proxy(Object.create(null), {
    has: (_target, request) => request in extra || request in base || request in defaults || request in plainLanguageTicketStubs,
    get: (_target, request) =>
      request in extra ? extra[request]
      : request in base ? base[request]
      : request in defaults ? defaults[request]
      : plainLanguageTicketStubs[request],
  });
}

module.exports = { withStubs, enforcementFor, quietPersonalLogStub, emailStraightBoardStubs, straightBoardGuardStubs };
