function enforcementFor(guard) {
  return {
    agentWritingPolicyEnabled: async () => true,
    enforceAgentWriting: async (_userId, ...writing) => guard.assertAgentWriting(...writing),
  }
}

const plainLanguageTicketStubs = require("./plain-language-ticket-stubs.cjs");

const emailStraightBoardStubs = {
  "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
  "@/lib/telemetry/signupAnalytics": { signupAttributionFromHeaders: () => ({}) },
  "@/lib/flags/definitions/htpr-7553-email-straight-board": { HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG: "htpr-7553-email-straight-board" },
  "@/lib/auth/emailStraightBoard": {
    finishStraightBoardEmailSignup: async () => ({ ok: false }),
    sendSignupVerificationEmail: async () => {},
    clearStraightBoardSignupCookie: () => {},
    blockUnverifiedStraightBoardInvite: async () => false,
    straightBoardSignupRequesterAllowed: async () => false,
    sessionEmailUnverified: async () => false,
    isPlausibleSignupEmail: () => true,
    STRAIGHT_BOARD_SIGNUP_COOKIE: "ht_straight_board_signup",
  },
};

function withStubs(base = {}, extra = {}) {
  const guard = base['@/lib/agents/writing']
  if (guard && !base['@/lib/agents/writingEnforcement']) {
    base = { ...base, '@/lib/agents/writingEnforcement': enforcementFor(guard) }
  }
  return new Proxy(Object.create(null), {
    has: (_target, request) => request in extra || request in base || request in plainLanguageTicketStubs,
    get: (_target, request) => (request in extra ? extra[request] : request in base ? base[request] : plainLanguageTicketStubs[request]),
  });
}

module.exports = { withStubs, enforcementFor, emailStraightBoardStubs };
