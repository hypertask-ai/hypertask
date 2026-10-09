const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7031-invite-email";
let enabled = true;
let sent = [];
let flagCalls = [];
let existingInvite;
let sessionCookie;
let redeemed;
let inviter;
const board = { id: 42, title: "R&D #1 + Q? 日本語 %26", name: "project-42", owner: { email: "owner@example.test" } };

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/lib/flags.ts", {
  HTPR_7031_INVITE_EMAIL_FLAG: flagKey,
  isFeatureEnabled: async (key, userId) => {
    flagCalls.push({ key, userId });
    return enabled;
  },
});
stub("src/lib/prisma.ts", { default: {
  user: { findUnique: async () => inviter, findFirst: async () => null },
  project: {
    findFirst: async () => ({ ...board, members: [], teamId: "team" }),
    findUnique: async () => board,
  },
  team: { findFirst: async () => ({ googleAccount: { userId: 7 }, members: [] }) },
  invite: {
    findMany: async () => [],
    findFirst: async () => existingInvite,
    update: async () => ({}),
    create: async () => ({ id: "invite&#+?日本語", invitedBy: inviter, project: board }),
  },
} });
stub("src/utils/controllers/logs/createLog.ts", { default: async () => {} });
stub("src/utils/controllers/projects/getAll.ts", { getProjectViewInclude: () => ({}) });
stub("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts", { getViewFromProject: () => undefined });
stub("src/lib/demo/guestGuard.ts", { isGuestRequest: async () => false });
stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => ({ userId: 7 }) });
stub("src/utils/controllers/getMemberAndOwnerForBoard.ts", { default: async () => [7] });
stub("src/pages/api/invite/cancelInvite.ts", { cancelInvite: async () => {} });
stub("src/lib/email/sendEmail.ts", { sendEmail: async (email) => { sent.push(email); return { id: "test-email" }; } });
stub("src/utils/controllers/notifications/digest.ts", { enqueueDigest: async () => false });
stub("src/utils/controllers/notifications/projectMute.ts", { isTaskProjectMuted: async () => false });
stub("src/lib/email/unsubscribe.ts", { unsubscribeHeaders: () => ({}) });
stub("src/lib/email/inboundReply.ts", { createNotificationReplyAddress: () => "reply@example.test" });
stub("src/utils/controllers/invite/getInvite.ts", { default: async () => ({ json: { projectId: board.id } }) });
stub("src/utils/controllers/members/invite.ts", { default: async (...args) => { redeemed = args; return { status: 200 }; } });
stub("src/app/invite/InviteComp.tsx", { default: () => null });
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: {
  cookies: async () => ({ get: () => sessionCookie }),
} };
const navigationPath = require.resolve("next/navigation");
require.cache[navigationPath] = { id: navigationPath, filename: navigationPath, loaded: true, exports: {
  redirect: (url) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); },
} };

const jiti = createJiti(__filename, { interopDefault: true, jsx: { runtime: "automatic" }, alias: { "@": path.join(root, "src") } });
const { generateInviteLink, addMemberController } = jiti(path.join(root, "src/pages/api/invite/createInviteLink.ts"));
const resend = jiti(path.join(root, "src/pages/api/invite/reSendInvite.ts")).default;
const { sendEmailNotification } = jiti(path.join(root, "src/utils/controllers/notifications/sendNotification.ts"));
const { renderNotificationEmail } = jiti(path.join(root, "src/utils/controllers/notifications/emailTemplates.ts"));
const invitePage = jiti(path.join(root, "src/app/invite/page.tsx")).default;
const publicInvite = jiti(path.join(root, "src/pages/api/invite/generatePublicInvite.ts")).default;
const { getInviteFromProjectId } = jiti(path.join(root, "src/utils/api/invite/generatePublicInviteController.ts"));

const body = {
  sender: "hyperreview467734", senderEmail: "hyperreview467734@yopmail.com", senderUserId: 7,
  recipient: "htpr7031-invite@yopmail.com", title: board.title,
  link: "https://app.hypertask.ai/invite?key=test&projectId=42",
};

const originalBaseUrl = process.env.NEXT_PUBLIC_BASEURL;
test.after(() => {
  if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASEURL;
  else process.env.NEXT_PUBLIC_BASEURL = originalBaseUrl;
});

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";
  enabled = true;
  sent = [];
  flagCalls = [];
  sessionCookie = undefined;
  redeemed = undefined;
  inviter = { id: 7, displayName: body.sender, email: body.senderEmail, userPicture: null };
  existingInvite = { id: "invite&#+?日本語", project: board };
});

test("all invite query values round-trip punctuation, unicode and literal percent escapes", async () => {
  const key = "invite&#+?日本語";
  const view = "view&#+?日本語";
  const url = new URL(await generateInviteLink(key, 42, board.title, view, 7), "https://app.hypertask.ai");
  assert.equal(url.hash, "");
  assert.deepEqual(Object.fromEntries(url.searchParams), { key, project: board.title, projectId: "42", view });
  assert.deepEqual(flagCalls, [{ key: flagKey, userId: 7 }]);
  const noView = new URL(await generateInviteLink(key, 42, board.title, undefined, 7), "https://app.hypertask.ai");
  assert.equal(noView.searchParams.has("view"), false);
});

test("public invite callers await the shared link builder instead of returning a Promise in JSON", async () => {
  const existing = await getInviteFromProjectId(42, 7);
  existingInvite = null;
  const created = await getInviteFromProjectId(42, 7);
  let reset;
  await publicInvite({ method: "POST", headers: {}, body: { projectId: 42 } }, {
    status: (status) => ({ json: (value) => { assert.equal(status, 200); reset = value; } }),
  });
  for (const result of [existing, created, reset]) {
    assert.equal(typeof result.inviteLink, "string");
    const url = new URL(result.inviteLink);
    assert.equal(url.searchParams.get("key"), "invite&#+?日本語");
    assert.equal(url.searchParams.get("projectId"), "42");
  }
});

test("Off preserves the legacy link builder", async () => {
  enabled = false;
  const link = await generateInviteLink("test", 42, "Plain board", "kanban", 7);
  assert.ok(link.endsWith("/invite?key=test&project=Plain board&projectId=42&view=kanban"));
});

test("send and resend deliver the board title and normalized inviter to the real email boundary", async () => {
  const result = await addMemberController(7, 42, [body.recipient]);
  assert.equal(result.status, 200);
  await resend({ headers: {}, body: { projectId: 42, email: body.recipient, userId: 7 } }, {
    status: () => ({ json: (value) => assert.fail(JSON.stringify(value)) }),
  });
  assert.equal(sent.length, 2);
  for (const email of sent) {
    assert.equal(email.subject, `A teammate invited you to "${board.title}" on Hypertask`);
    assert.equal(email.from, '"A teammate" <notifications@hypertask.ai>');
    const href = email.html.match(/class="cta" href="([^"]+)"/)[1].replaceAll("&amp;", "&");
    const url = new URL(href, "https://app.hypertask.ai");
    assert.equal(url.searchParams.get("project"), board.title);
    assert.equal(url.searchParams.get("key"), existingInvite.id);
  }
});

test("send and resend use an explicitly saved profile name when the display name is still the handle", async () => {
  inviter.userPicture = { nameSet: true, displayName: "Valentin Yeo" };
  await addMemberController(7, 42, [body.recipient]);
  await resend({ headers: {}, body: { projectId: 42, email: body.recipient, userId: 7 } }, {
    status: () => ({ json: (value) => assert.fail(JSON.stringify(value)) }),
  });
  assert.equal(sent.length, 2);
  for (const email of sent) {
    assert.equal(email.subject, `Valentin Yeo invited you to "${board.title}" on Hypertask`);
    assert.equal(email.from, '"Valentin Yeo" <notifications@hypertask.ai>');
  }
});

test("default email handle becomes A teammate with product and agent context", async () => {
  await sendEmailNotification("Invite", body);
  assert.equal(sent[0].from, '"A teammate" <notifications@hypertask.ai>');
  assert.equal(sent[0].subject, `A teammate invited you to "${board.title}" on Hypertask`);
  assert.match(sent[0].html, /people and AI agents \(Claude Code, Cursor and others\) pick up and finish tasks together/);
  assert.match(sent[0].html, />Accept invite<\/a>/);
  assert.deepEqual(flagCalls, [{ key: flagKey, userId: 7 }]);
});

test("known profile name and genuine display name are kept; blank and case-insensitive handles fall back", async () => {
  for (const [sender, senderName, expected] of [
    [body.sender, "Valentin Yeo", "Valentin Yeo"],
    ["Alice Smith", undefined, "Alice Smith"],
    [" HYPERREVIEW467734 ", undefined, "A teammate"],
    ["", "", "A teammate"],
    [body.sender, body.sender, "A teammate"],
  ]) {
    await sendEmailNotification("Invite", { ...body, sender, senderName });
    assert.equal(sent.at(-1).subject, `${expected} invited you to "${board.title}" on Hypertask`);
  }
});

test("Off restores old sender and copy; other notification types do not evaluate the invite flag", async () => {
  enabled = false;
  await sendEmailNotification("Invite", body);
  assert.equal(sent[0].from, `${body.sender} <notifications@hypertask.ai>`);
  assert.equal(sent[0].subject, `${body.sender} has invited you to the Kanban Board "${board.title}"`);
  assert.doesNotMatch(sent[0].html, /people and AI agents/);
  const before = flagCalls.length;
  await sendEmailNotification("Comment", body);
  assert.equal(flagCalls.length, before);
  assert.equal(sent[1].subject, `${body.sender} commented on "${board.title}"`);
});

test("invite names and board titles remain HTML-escaped with the flag on and off", async () => {
  const malicious = { ...body, sender: 'Alice <img src=x> & "Bob"', title: '<script>alert("x")</script> & Board' };
  for (const state of [true, false]) {
    enabled = state;
    await sendEmailNotification("Invite", malicious);
    const email = sent.at(-1);
    assert.doesNotMatch(email.html, /<img|<script/);
    assert.match(email.html, /&lt;img src=x&gt;/);
    assert.match(email.html, /&lt;script&gt;/);
    assert.match(email.html, /&amp; Board/);
  }
  assert.equal(renderNotificationEmail("Invite", malicious).subject,
    `${malicious.sender} has invited you to the Kanban Board "${malicious.title}"`);
});

test("accept page receives already-decoded titles once and redeems by invite key and board id", async () => {
  const view = "view&#+?日本語 %26";
  const link = await generateInviteLink(existingInvite.id, 42, board.title, view, 7);
  const searchParams = Object.fromEntries(new URL(link, "https://app.hypertask.ai").searchParams);
  const page = await invitePage({ searchParams: Promise.resolve(searchParams) });
  assert.equal(page.props.project, board.title);
  assert.equal(page.props.inviteKey, existingInvite.id);
  sessionCookie = { value: JSON.stringify({ id: 99 }) };
  await assert.rejects(invitePage({ searchParams: Promise.resolve(searchParams) }), {
    message: `/project?id=42&view=${encodeURIComponent(view)}`,
  });
  assert.deepEqual(redeemed, [99, 42, existingInvite.id]);
});

test("unused legacy sender is absent and the source search detects a positive caller control", () => {
  const hasCaller = (source) => /(?:from\s*|require\s*\(|import\s*\()["'][^"']*sendInviteEmail["']/.test(source);
  assert.equal(hasCaller('import sendInviteEmail from "./sendInviteEmail"'), true);
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(filename);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) assert.equal(hasCaller(fs.readFileSync(filename, "utf8")), false, filename);
    }
  }
  scan(path.join(root, "src"));
  assert.equal(fs.existsSync(path.join(root, "src/utils/controllers/invite/sendInviteEmail.js")), false);
});
