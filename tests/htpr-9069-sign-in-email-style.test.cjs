const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { NextRequest } = require("next/server");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const { emailStraightBoardStubs } = require("./helpers/stub-map.cjs");

const STYLE_FLAG = "htpr-9069-sign-in-email-style";
const testSecret = "htpr-9069-unit-test-signing-key";
process.env.JWT_SECRET = testSecret;
process.env.RESEND_API_KEY = "unit-test-no-network";

function harness(t, { styledLayout = true, existingUser = null } = {}) {
  t.mock.method(console, "log", () => {});
  const sent = [];
  const records = new Map();
  const flagReads = [];
  const prisma = {
    user: { findFirst: async () => existingUser, findUnique: async () => existingUser },
    verificationCode: {
      upsert: async ({ where, create, update }) => {
        const record = records.get(where.email);
        records.set(where.email, record ? { ...record, ...update } : create);
      },
    },
  };
  const keys = {
    HTPR_7032_EMAIL_EXPIRY_COPY_FLAG: "htpr-7032-email-expiry-copy",
    HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG: "htpr-7553-email-straight-board",
    HTPR_9069_SIGN_IN_EMAIL_STYLE_FLAG: STYLE_FLAG,
  };
  const { POST } = load("src/app/api/auth/send-email-link/route.ts", {
    ...emailStraightBoardStubs,
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => {
        flagReads.push(key);
        return key === STYLE_FLAG ? styledLayout : key === keys.HTPR_7032_EMAIL_EXPIRY_COPY_FLAG;
      },
    },
    "@/lib/flags/keys": keys,
    "@/lib/telemetry/signupAnalytics": { signupAttributionFromHeaders: () => ({}) },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
    "@/utils/controllers/users/findUserByEmail": { findUserByEmail: async () => null },
    "@/lib/services/verificationCodeService": load("src/lib/services/verificationCodeService.ts", {
      "@/lib/prisma": { default: prisma },
    }),
    "@/lib/auth/safeReturnTo": load("src/lib/auth/safeReturnTo.ts"),
    "@/lib/auth/requestBaseUrl": load("src/lib/auth/requestBaseUrl.ts"),
    "@/lib/auth/signupAttributionContext": { createSignupContext: async () => null, bindSignupCodeContext: async () => {} },
    "@/lib/email/sendEmail": { sendEmail: async (email) => sent.push(email) },
  });
  return {
    sent,
    records,
    flagReads,
    send: () =>
      POST(
        new NextRequest("https://app.hypertask.ai/api/auth/send-email-link", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-host": "app.hypertask.ai" },
          body: JSON.stringify({ email: "style-qa@yopmail.com" }),
        }),
      ),
  };
}

function visibleText(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
}

test("sign-in email uses the shared grey layout with no emoji, no blue and no raw long link", async (t) => {
  const h = harness(t, { existingUser: { id: 6 } });
  assert.equal((await h.send()).status, 200);
  const email = h.sent.at(-1);
  const html = email.html;
  const code = h.records.get("style-qa@yopmail.com").code;

  assert.equal(email.subject, "Sign in to Hypertask");
  assert.match(html, /class="email-card"/);
  assert.match(html, />Hypertask</);
  assert.match(html, /class="cta"[^>]*background-color:#5C6070[^>]*>Sign in<\/a>/);
  assert.match(html, /class="secondary-cta"[^>]*>Copy link<\/a>/);
  assert.ok(html.includes(code));
  assert.match(html, /This link expires in 15 minutes\./);
  assert.match(html, /This code expires in 30 minutes\./);
  assert.match(html, /You got this email because someone asked to sign in with this address\./);

  for (const offStyle of ["#2563eb", "#4455BB", "#111827", "border-radius:8px", "border-radius:999px", "border-radius:12px", "🎯", "🔐"]) {
    assert.equal(html.includes(offStyle), false, `sign-in email still carries ${offStyle}`);
  }
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.equal(visibleText(html).includes("https://"), false, "the long link is hidden behind the Copy link text");

  const link = new URL(html.match(/<a class="cta" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  const payload = jwt.verify(link.searchParams.get("token"), testSecret);
  assert.equal(payload.sub, "style-qa@yopmail.com");
  assert.ok(h.flagReads.includes(STYLE_FLAG));
});

test("flag Off keeps the previous sign-in email so the change reverts in one switch", async (t) => {
  const h = harness(t, { styledLayout: false });
  assert.equal((await h.send()).status, 200);
  const html = h.sent.at(-1).html;
  assert.match(html, /#2563eb/);
  assert.match(html, /Quick Sign-in Link/);
  assert.equal(html.includes('class="cta"'), false);
});

test("notification, digest and onboarding emails share the same grey style and 4px corners", () => {
  const templates = load("src/utils/controllers/notifications/emailTemplates.ts", {
    "@/utils/htmlEscape": load("src/utils/htmlEscape.ts"),
    "./commentPreview": { commentPreview: () => "A short comment" },
    "./mentionText": { mentionQuoteHtml: () => "A short comment" },
  });
  const { renderOnboardingEmail } = load("src/lib/onboarding/emails/layout.ts", {
    "@/utils/controllers/notifications/emailTemplates": templates,
    "@/utils/htmlEscape": load("src/utils/htmlEscape.ts"),
  });
  const comment = templates.renderNotificationEmail("Comment", {
    sender: "Ada", title: "Ship the release", link: "https://app.hypertask.ai/detail/project-15/1", recipient: "qa@example.test",
  });
  const digest = templates.renderDigestEmail("Ship the release", "https://app.hypertask.ai/detail/project-15/1", [{ line: "Ada commented" }]);
  const onboarding = renderOnboardingEmail({
    subject: "Your board is live",
    heading: "Your board is live",
    paragraphs: ["Short sentence."],
    code: "claude mcp add",
    cta: { label: "Open my board", url: "https://app.hypertask.ai/project?id=42" },
  });
  for (const email of [comment, digest, onboarding]) {
    assert.ok(email.html.includes("background-color:#EFEFF1"));
    assert.ok(email.html.includes("background-color:#5C6070"));
    assert.equal(email.html.includes("#4455BB"), false);
    assert.equal(email.html.includes("border-radius:999px"), false);
  }
});
