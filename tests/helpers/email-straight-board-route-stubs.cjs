module.exports = function emailStraightBoardRouteStubs(extra = {}) {
  return {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
    "@/lib/flags/definitions/htpr-7553-email-straight-board": {
      HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG: "htpr-7553-email-straight-board",
    },
    "@/lib/auth/emailStraightBoard": {
      finishStraightBoardEmailSignup: async () => ({ ok: false }),
      sendSignupVerificationEmail: async () => {},
      clearStraightBoardSignupCookie: () => {},
      blockUnverifiedStraightBoardInvite: async () => false,
      hasStraightBoardSignupCookie: () => false,
      sessionEmailUnverified: async () => false,
      straightBoardSignupAllowed: async () => false,
    },
    ...extra,
  };
};
