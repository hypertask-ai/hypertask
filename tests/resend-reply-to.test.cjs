const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/resend-reply-to-jiti.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

test("the shared Resend mailer forwards Reply-To and bounds the request", async () => {
  const { sendEmail } = jiti(path.join(root, "src/lib/email/sendEmail.ts"));
  const originalFetch = global.fetch;
  const originalTimeout = AbortSignal.timeout;
  const originalKey = process.env.RESEND_API_KEY;
  const timeoutSignal = new AbortController().signal;
  const timeoutCalls = [];
  const requests = [];
  process.env.RESEND_API_KEY = crypto.randomBytes(32).toString("hex");
  AbortSignal.timeout = (milliseconds) => {
    timeoutCalls.push(milliseconds);
    return timeoutSignal;
  };
  global.fetch = async (_url, options) => {
    requests.push({ body: JSON.parse(options.body), signal: options.signal });
    return new Response(JSON.stringify({ id: "email-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await sendEmail({
      to: "person@example.com",
      from: "Hypertask <notifications@hypertask.ai>",
      replyTo: "reply+abc@example.com",
      subject: "Update",
      html: "<p>Body</p>",
    });
  } finally {
    global.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }

  assert.deepEqual(timeoutCalls, [5000]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal, timeoutSignal);
  assert.equal(requests[0].body.reply_to, "reply+abc@example.com");
});

test("the shared Resend mailer reports its request timeout clearly", async () => {
  const { sendEmail } = jiti(path.join(root, "src/lib/email/sendEmail.ts"));
  const originalFetch = global.fetch;
  const originalTimeout = AbortSignal.timeout;
  const originalKey = process.env.RESEND_API_KEY;
  const timeoutSignal = new AbortController().signal;
  process.env.RESEND_API_KEY = crypto.randomBytes(32).toString("hex");
  AbortSignal.timeout = () => timeoutSignal;
  global.fetch = async (_url, options) => {
    assert.equal(options.signal, timeoutSignal);
    throw new DOMException("The operation timed out", "TimeoutError");
  };

  try {
    await assert.rejects(
      sendEmail({
        to: "person@example.com",
        from: "Hypertask <notifications@hypertask.ai>",
        subject: "Update",
        text: "Body",
      }),
      /Resend API request timed out after 5000ms/,
    );
  } finally {
    global.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
});

test("the shared Resend mailer preserves non-timeout failures", async () => {
  const { sendEmail } = jiti(path.join(root, "src/lib/email/sendEmail.ts"));
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const providerError = new Error("network unavailable");
  process.env.RESEND_API_KEY = crypto.randomBytes(32).toString("hex");
  global.fetch = async () => {
    throw providerError;
  };

  try {
    await assert.rejects(
      sendEmail({
        to: "person@example.com",
        from: "Hypertask <notifications@hypertask.ai>",
        subject: "Update",
        text: "Body",
      }),
      (error) => error === providerError,
    );
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
});

test("an immediate task notification gets a signed Reply-To address", async () => {
  const sent = [];
  const previous = {
    session: process.env.SESSION_SECRET,
    webhook: process.env.RESEND_WEBHOOK_SECRET,
    domain: process.env.RESEND_INBOUND_DOMAIN,
  };
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  process.env.RESEND_WEBHOOK_SECRET = crypto.randomBytes(32).toString("hex");
  process.env.RESEND_INBOUND_DOMAIN = "reply.hypertask.ai";

  stubModule("src/lib/email/sendEmail.ts", {
    sendEmail: async (options) => {
      sent.push(options);
      return { id: "email-2" };
    },
  });
  stubModule("src/lib/email/unsubscribe.ts", {
    unsubscribeHeaders: () => ({}),
  });
  stubModule("src/utils/controllers/notifications/digest.ts", {
    enqueueDigest: async () => false,
  });
  stubModule("src/utils/controllers/notifications/projectMute.ts", {
    isTaskProjectMuted: async () => false,
  });
  stubModule("src/utils/controllers/notifications/emailTemplates.ts", {
    renderNotificationEmail: () => ({ subject: "Update", html: "<p>Body</p>" }),
  });

  try {
    const loader = require("jiti")(
      path.join(root, "tests/resend-notification-reply-to-jiti.cjs"),
      {
        interopDefault: true,
        alias: { "@": path.join(root, "src") },
        cache: false,
      },
    );
    const { sendEmailNotification } = loader(
      path.join(
        root,
        "src/utils/controllers/notifications/sendNotification.ts",
      ),
    );
    await sendEmailNotification("Comment", {
      sender: "Person",
      recipient: "recipient@example.com",
      title: "Task",
      link: "https://app.hypertask.ai/detail/project-15/4163",
      userId: 6,
      replyTaskId: 23720,
    });

    // Assert the claimed signature, not just the shape: a random suffix, or a
    // valid token minted for another user or task, must not verify.
    const { verifyInboundReplyAddress } = loader(
      path.join(root, "src/lib/email/inboundReply.ts"),
    );
    assert.equal(sent.length, 1);
    assert.deepEqual(verifyInboundReplyAddress(sent[0].replyTo), {
      taskId: 23720,
      userId: 6,
    });
    const [localPart, domain] = sent[0].replyTo.split("@");
    // Flip the FIRST signature character, not the last: a base64url tail
    // character carries unused low bits, so changing it can decode to the same
    // bytes and leave the tamper undetected.
    const signatureAt = localPart.length - 22;
    const tampered = `${localPart.slice(0, signatureAt)}${localPart[signatureAt] === "a" ? "b" : "a"}${localPart.slice(signatureAt + 1)}@${domain}`;
    assert.equal(verifyInboundReplyAddress(tampered), null);
  } finally {
    if (previous.session === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous.session;
    if (previous.webhook === undefined)
      delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = previous.webhook;
    if (previous.domain === undefined) delete process.env.RESEND_INBOUND_DOMAIN;
    else process.env.RESEND_INBOUND_DOMAIN = previous.domain;
  }

  assert.match(
    sent[0].replyTo,
    /^reply\+[0-9a-z]+\.[0-9a-z]+\.[0-9a-z]+\.[A-Za-z0-9_-]{22}@reply\.hypertask\.ai$/,
  );
});
