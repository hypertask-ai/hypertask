const QUIET_PERSONAL_LOG = "@/utils/controllers/logs/quietPersonalLog"
const USER_COMMENT_COUNTS = "@/utils/controllers/tasks/userCommentCounts"

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

const sharedTicketWritingStubs = {
  "@/lib/agents/writing": {
    AgentWritingError: class AgentWritingError extends Error {},
    assertAgentWriting() {},
  },
  "@/lib/agents/writingEnforcement": {
    enforceAgentWriting: async () => {},
    agentWritingPolicyEnabled: async () => false,
    peopleCommentWholeCheckEnabled: async () => false,
  },
  "@/lib/flags/definitions/htpr-8905-shared-ticket-writing": {
    HTPR_8905_SHARED_TICKET_WRITING_FLAG: "htpr-8905-shared-ticket-writing",
  },
};

const agentPulseDotStubs = {
  "@/utils/controllers/tasks/attachAgentStatus": {
    attachAgentStatus: async (tasks) => tasks.map((task) => ({ ...task, agentStatus: null })),
  },
  "@/lib/flags/definitions/htpr-7339-agent-pulse-dot": {
    HTPR_7339_AGENT_PULSE_DOT_FLAG: "htpr-7339-agent-pulse-dot",
  },
};

const waitingActivityStubs = {
  "@/lib/tasks/redactWaitingActivities": { withPublicWaitingActivities: async (rows) => rows, redactSharedPrivateWaitingActivities: async (rows) => rows, concealedWaitingDisplayNames: async () => [], scrubStoredTaskSummary: async (content) => content },
  "@/lib/tasks/waitingOnActivitySql": { visibleWaitingOnActivity: () => ({}) },
  "@/lib/tasks/waitingAgentPrivacy": { presentWaitingAgent: (task) => task, collectWaitingTargets: () => ({ ids: [], names: [] }), hiddenWaitingAgents: () => ({ hiddenIds: new Set(), hiddenNames: new Set() }), redactWaitingOnActivity: (activity) => activity },
};

const straightBoardGuardStubs = {
  "@/lib/auth/unverifiedEmailAccount": { unverifiedEmailAccount: async () => "allowed", accountNotificationsBlocked: async () => false },
};

const emailStraightBoardStubs = {
  ...straightBoardGuardStubs,
  "@/utils/controllers/users/findUserByEmail": { findUserByEmail: async () => null },
  "@/lib/flags/definitions/htpr-7553-email-straight-board": { HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG: "htpr-7553-email-straight-board" },
  "@/lib/auth/emailStraightBoard": { finishStraightBoardEmailSignup: async () => ({ ok: false }), sendSignupVerificationEmail: async () => {} },
};

const straightBoardRouteStubs = {
  ...emailStraightBoardStubs,
  "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
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
  if (!(USER_COMMENT_COUNTS in base) && !(USER_COMMENT_COUNTS in extra)) {
    defaults[USER_COMMENT_COUNTS] = { userCommentCountsByTaskId: async () => new Map() }
  }
  return new Proxy(Object.create(null), {
    has: (_target, request) => request in extra || request in base || request in defaults || request in sharedTicketWritingStubs || request in agentPulseDotStubs || request in emailStraightBoardStubs || request in plainLanguageTicketStubs || request in waitingActivityStubs,
    get: (_target, request) =>
      request in extra ? extra[request]
      : request in base ? base[request]
      : request in defaults ? defaults[request]
      : request in sharedTicketWritingStubs ? sharedTicketWritingStubs[request]
      : request in agentPulseDotStubs ? agentPulseDotStubs[request]
      : request in emailStraightBoardStubs ? emailStraightBoardStubs[request]
      : request in waitingActivityStubs ? waitingActivityStubs[request]
      : plainLanguageTicketStubs[request],
  });
}

module.exports = { withStubs, enforcementFor, quietPersonalLogStub, emailStraightBoardStubs, straightBoardRouteStubs, straightBoardGuardStubs, sharedTicketWritingStubs, waitingActivityStubs };
