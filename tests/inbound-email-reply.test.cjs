const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let entryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/inbound-email-jiti-${++entryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(path.join(root, relativePath));
}

const previousSessionSecret = process.env.SESSION_SECRET;
const previousInboundDomain = process.env.RESEND_INBOUND_DOMAIN;
const previousWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
process.env.RESEND_INBOUND_DOMAIN = "reply.hypertask.ai";
delete process.env.RESEND_WEBHOOK_SECRET;

test.after(() => {
  if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSessionSecret;
  if (previousInboundDomain === undefined)
    delete process.env.RESEND_INBOUND_DOMAIN;
  else process.env.RESEND_INBOUND_DOMAIN = previousInboundDomain;
  if (previousWebhookSecret === undefined)
    delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = previousWebhookSecret;
});

test("reply addresses bind one task and user without exceeding the local-part limit", () => {
  const { createInboundReplyAddress, verifyInboundReplyAddress } = loadTs(
    "src/lib/email/inboundReply.ts",
  );

  const address = createInboundReplyAddress(23720, 6);
  assert.deepEqual(verifyInboundReplyAddress(address), {
    taskId: 23720,
    userId: 6,
  });
  assert.ok(address.split("@")[0].length <= 64);

  const [localPart, domain] = address.split("@");
  // Flip the FIRST signature character, not the last: a base64url tail
  // character carries unused low bits, so changing it can decode to the same
  // bytes and leave the tamper undetected.
  const signatureAt = localPart.length - 22;
  const tampered = `${localPart.slice(0, signatureAt)}${localPart[signatureAt] === "a" ? "b" : "a"}${localPart.slice(signatureAt + 1)}@${domain}`;
  assert.equal(verifyInboundReplyAddress(tampered), null);
  assert.equal(
    verifyInboundReplyAddress(
      address.replace("reply.hypertask.ai", "example.com"),
    ),
    null,
  );
});

test("notifications keep sending without an inbound webhook configuration", () => {
  const { createNotificationReplyAddress } = loadTs(
    "src/lib/email/inboundReply.ts",
  );
  assert.equal(createNotificationReplyAddress(23720, 6), undefined);

  process.env.RESEND_WEBHOOK_SECRET = crypto.randomBytes(32).toString("hex");
  try {
    assert.match(
      createNotificationReplyAddress(23720, 6),
      /^reply\+.+@reply\.hypertask\.ai$/,
    );
  } finally {
    delete process.env.RESEND_WEBHOOK_SECRET;
  }
});

test("plain-text replies drop Gmail quotes, Outlook history, and quoted lines", () => {
  const { stripQuotedReply } = loadTs("src/lib/email/inboundReply.ts");

  assert.equal(
    stripQuotedReply(
      "The first line.\r\n\r\nThe second line.\r\n\r\nOn Sun, Aug 23, 2026 at 09:00 Alice <alice@example.com> wrote:\r\n> old reply",
    ),
    "The first line.\n\nThe second line.",
  );
  assert.equal(
    stripQuotedReply(
      "Approved\n\nFrom: Alice <alice@example.com>\nSent: Sunday\nTo: Valentin\nSubject: Old thread\nOld content",
    ),
    "Approved",
  );
});

test("HTML-only replies become sanitized comment paragraphs without quoted history", () => {
  const { buildInboundCommentHtml } = loadTs("src/lib/email/inboundReply.ts");

  const html = buildInboundCommentHtml({
    html: [
      "<div>Hello &amp; welcome<br>Second line</div>",
      '<img src="data:text/html,unsafe" onerror="alert(1)">',
      '<a href="javascript:alert(2)">safe label</a>',
      '<div class="gmail_quote">old text</div>',
      "<script>alert(3)</script>",
    ].join(""),
  });

  assert.equal(html, "<p>Hello &amp; welcome<br>Second line<br>safe label</p>");
  assert.doesNotMatch(html, /old text|script|alert|onerror|javascript:|data:/);
});

test("deeply nested HTML replies do not exhaust the call stack", () => {
  const { buildInboundCommentHtml } = loadTs("src/lib/email/inboundReply.ts");
  const html = `${"<div>".repeat(5_000)}Reply${"</div>".repeat(5_000)}`;

  assert.equal(buildInboundCommentHtml({ html }), "<p>Reply</p>");
});

test("empty quoted replies do not create empty comments", () => {
  const { buildInboundCommentHtml } = loadTs("src/lib/email/inboundReply.ts");
  assert.equal(
    buildInboundCommentHtml({ text: "> old reply\n> older reply" }),
    null,
  );
});

test("the received-email request identifies Hypertask to Resend", async () => {
  const { retrieveResendReceivedEmail } = loadTs(
    "src/lib/email/inboundReply.ts",
  );
  const previousKey = process.env.RESEND_API_KEY;
  const previousFetch = global.fetch;
  const testKey = crypto.randomBytes(32).toString("hex");
  let request;
  process.env.RESEND_API_KEY = testKey;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(
      JSON.stringify({
        id: "received-email-0",
        from: "person@example.com",
        to: ["reply@example.com"],
        text: "Hello",
      }),
      { status: 200 },
    );
  };

  try {
    await retrieveResendReceivedEmail("received-email-0");
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }

  assert.equal(
    request.url,
    "https://api.resend.com/emails/receiving/received-email-0",
  );
  assert.equal(request.options.headers.Authorization, `Bearer ${testKey}`);
  assert.equal(request.options.headers["User-Agent"], "Hypertask/1.0");
});

test("the inbound handler verifies the webhook before retrieving mail", async () => {
  const { createResendInboundHandler } = loadTs(
    "src/lib/email/inboundWebhookHandler.ts",
  );
  let retrieved = 0;
  const handler = createResendInboundHandler({
    verify: () => {
      throw new Error("bad signature");
    },
    retrieve: async () => {
      retrieved += 1;
      throw new Error("must not run");
    },
    findUser: async () => null,
    findTask: async () => null,
    createComment: async () => null,
    broadcast: async () => {},
  });

  const response = await handler(
    new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
      method: "POST",
      body: "{}",
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(retrieved, 0);
});

test("a verified email posts once as the matching member with a durable receipt id", async () => {
  const { createInboundReplyAddress } = loadTs("src/lib/email/inboundReply.ts");
  const { createResendInboundHandler } = loadTs(
    "src/lib/email/inboundWebhookHandler.ts",
  );
  const address = createInboundReplyAddress(99, 6);
  const comments = [];
  const commentsByEmailId = new Map();
  const broadcasts = [];
  const handler = createResendInboundHandler({
    verify: () => ({
      type: "email.received",
      data: {
        email_id: "received-email-1",
        from: "person@example.com",
        to: [address],
      },
    }),
    retrieve: async () => ({
      id: "received-email-1",
      from: "Person <person@example.com>",
      to: [address],
      text: "Ship it.\n\nOn Sunday, Alice wrote:\n> old",
    }),
    findUser: async () => ({
      id: 6,
      email: "person@example.com",
      displayName: "Person",
      photoURL: null,
    }),
    findTask: async (taskId, userId) => {
      assert.deepEqual({ taskId, userId }, { taskId: 99, userId: 6 });
      return { id: 99, userId: 8 };
    },
    createComment: async (input) => {
      if (!commentsByEmailId.has(input.inboundEmailId)) {
        comments.push(input);
        commentsByEmailId.set(input.inboundEmailId, { id: 501 });
      }
      return commentsByEmailId.get(input.inboundEmailId);
    },
    broadcast: async (taskId, userId) => broadcasts.push({ taskId, userId }),
  });

  const responses = await Promise.all([
    handler(
      new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
        method: "POST",
        body: "signed body",
      }),
    ),
    handler(
      new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
        method: "POST",
        body: "signed body",
      }),
    ),
  ]);
  assert.deepEqual(
    responses.map(({ status }) => status),
    [200, 200],
  );
  assert.equal(comments.length, 1);
  assert.equal(comments[0].text, "<p>Ship it.</p>");
  assert.equal(comments[0].creatorId, 6);
  assert.equal(comments[0].ownerId, 8);
  assert.equal(comments[0].inboundEmailId, "received-email-1");
  assert.deepEqual(broadcasts, [
    { taskId: 99, userId: 6 },
    { taskId: 99, userId: 6 },
  ]);
});

test("a deleted inbound comment stays suppressed on replay", async () => {
  const { createInboundReplyAddress } = loadTs("src/lib/email/inboundReply.ts");
  const { createResendInboundHandler } = loadTs(
    "src/lib/email/inboundWebhookHandler.ts",
  );
  const address = createInboundReplyAddress(99, 6);
  let broadcasts = 0;
  const handler = createResendInboundHandler({
    verify: () => ({
      type: "email.received",
      data: {
        email_id: "received-email-deleted",
        from: "person@example.com",
        to: [address],
      },
    }),
    retrieve: async () => ({
      id: "received-email-deleted",
      from: "person@example.com",
      to: [address],
      text: "Do not restore this deleted reply",
    }),
    findUser: async () => ({
      id: 6,
      email: "person@example.com",
      displayName: "Person",
      photoURL: null,
    }),
    findTask: async () => ({ id: 99, userId: 8 }),
    createComment: async () => false,
    broadcast: async () => {
      broadcasts += 1;
    },
  });

  const response = await handler(
    new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
      method: "POST",
      body: "signed body",
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(broadcasts, 0);
});

test("sender mismatch and lost board access fail closed without a comment", async () => {
  const { createInboundReplyAddress } = loadTs("src/lib/email/inboundReply.ts");
  const { createResendInboundHandler } = loadTs(
    "src/lib/email/inboundWebhookHandler.ts",
  );
  const address = createInboundReplyAddress(99, 6);
  let comments = 0;
  let taskLookups = 0;
  const base = {
    verify: () => ({
      type: "email.received",
      data: {
        email_id: "received-email-2",
        from: "attacker@example.com",
        to: [address],
      },
    }),
    retrieve: async () => ({
      id: "received-email-2",
      from: "attacker@example.com",
      to: [address],
      text: "Forged reply",
    }),
    findUser: async () => ({
      id: 6,
      email: "person@example.com",
      displayName: "Person",
      photoURL: null,
    }),
    findTask: async () => {
      taskLookups += 1;
      return null;
    },
    createComment: async () => {
      comments += 1;
      return null;
    },
    broadcast: async () => {},
  };

  const mismatch = await createResendInboundHandler(base)(
    new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
      method: "POST",
      body: "signed body",
    }),
  );
  assert.equal(mismatch.status, 200);
  assert.equal(taskLookups, 0);
  assert.equal(comments, 0);

  const noAccess = await createResendInboundHandler({
    ...base,
    verify: () => ({
      type: "email.received",
      data: {
        email_id: "received-email-3",
        from: "person@example.com",
        to: [address],
      },
    }),
    retrieve: async () => ({
      id: "received-email-3",
      from: "person@example.com",
      to: [address],
      text: "Real sender, no access",
    }),
  })(
    new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
      method: "POST",
      body: "signed body",
    }),
  );
  assert.equal(noAccess.status, 200);
  assert.equal(taskLookups, 1);
  assert.equal(comments, 0);
});

test("the signed recipient must match in the webhook and retrieved email", async () => {
  const { createInboundReplyAddress } = loadTs("src/lib/email/inboundReply.ts");
  const { createResendInboundHandler } = loadTs(
    "src/lib/email/inboundWebhookHandler.ts",
  );
  let comments = 0;
  const handler = createResendInboundHandler({
    verify: () => ({
      type: "email.received",
      data: {
        email_id: "received-email-mismatch",
        from: "person@example.com",
        to: [createInboundReplyAddress(99, 6)],
      },
    }),
    retrieve: async () => ({
      id: "received-email-mismatch",
      from: "person@example.com",
      to: [createInboundReplyAddress(100, 6)],
      text: "Wrong thread",
    }),
    findUser: async () => null,
    findTask: async () => null,
    createComment: async () => {
      comments += 1;
      return null;
    },
    broadcast: async () => {},
  });

  const response = await handler(
    new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
      method: "POST",
      body: "signed body",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(comments, 0);
});

test("a failed realtime broadcast stays retryable after the comment is stored", async () => {
  const { createInboundReplyAddress } = loadTs("src/lib/email/inboundReply.ts");
  const { createResendInboundHandler } = loadTs(
    "src/lib/email/inboundWebhookHandler.ts",
  );
  const address = createInboundReplyAddress(99, 6);
  let storedComments = 0;
  let broadcastAttempts = 0;
  const handler = createResendInboundHandler({
    verify: () => ({
      type: "email.received",
      data: {
        email_id: "received-email-broadcast",
        from: "person@example.com",
        to: [address],
      },
    }),
    retrieve: async () => ({
      id: "received-email-broadcast",
      from: "person@example.com",
      to: [address],
      text: "Stored before broadcast",
    }),
    findUser: async () => ({
      id: 6,
      email: "person@example.com",
      displayName: "Person",
      photoURL: null,
    }),
    findTask: async () => ({ id: 99, userId: 8 }),
    createComment: async () => {
      if (storedComments === 0) storedComments += 1;
      return { id: 502 };
    },
    broadcast: async () => {
      broadcastAttempts += 1;
      if (broadcastAttempts === 1) throw new Error("realtime unavailable");
    },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const first = await handler(
      new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
        method: "POST",
        body: "signed body",
      }),
    );
    const retry = await handler(
      new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
        method: "POST",
        body: "signed body",
      }),
    );
    assert.equal(first.status, 500);
    assert.equal(retry.status, 200);
  } finally {
    console.error = originalError;
  }
  assert.equal(storedComments, 1);
  assert.equal(broadcastAttempts, 2);
});

test("temporary retrieval failures return 500 so Resend retries", async () => {
  const { createResendInboundHandler } = loadTs(
    "src/lib/email/inboundWebhookHandler.ts",
  );
  const handler = createResendInboundHandler({
    verify: () => ({
      type: "email.received",
      data: {
        email_id: "received-email-4",
        from: "person@example.com",
        to: [],
      },
    }),
    retrieve: async () => {
      throw new Error("Resend unavailable");
    },
    findUser: async () => null,
    findTask: async () => null,
    createComment: async () => null,
    broadcast: async () => {},
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await handler(
      new Request("https://app.hypertask.ai/api/webhooks/resend-inbound", {
        method: "POST",
        body: "signed body",
      }),
    );
    assert.equal(response.status, 500);
  } finally {
    console.error = originalError;
  }
});

test("reply addresses expire so a leaked notification cannot impersonate forever", () => {
  const { createInboundReplyAddress, verifyInboundReplyAddress } = loadTs(
    "src/lib/email/inboundReply.ts",
  );

  const DAY_MS = 86_400_000;
  const realNow = Date.now;
  let stale;
  let recent;
  let future;
  try {
    Date.now = () => realNow() - 61 * DAY_MS;
    stale = createInboundReplyAddress(23720, 6);
    Date.now = () => realNow() - 59 * DAY_MS;
    recent = createInboundReplyAddress(23720, 6);
    Date.now = () => realNow() + 2 * DAY_MS;
    future = createInboundReplyAddress(23720, 6);
  } finally {
    Date.now = realNow;
  }

  // A notification forwarded out of the mailbox stops working once the stamp
  // ages out, and a forged future stamp cannot buy a longer-lived credential.
  assert.equal(verifyInboundReplyAddress(stale), null);
  assert.equal(verifyInboundReplyAddress(future), null);
  assert.deepEqual(verifyInboundReplyAddress(recent), {
    taskId: 23720,
    userId: 6,
  });
});
