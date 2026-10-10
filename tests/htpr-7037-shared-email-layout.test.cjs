const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { load, root } = require("./helpers/agent-connection.cjs");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flag = "htpr-7037-shared-email-layout";
const legacyTemplates = load("src/utils/controllers/notifications/emailTemplates.ts", {
  "@/utils/htmlEscape": load("src/utils/htmlEscape.ts"),
  "./commentPreview": { commentPreview: () => "" },
  "./mentionText": { mentionQuoteHtml: () => "" },
});
const layout = load("src/lib/onboarding/emails/layout.ts", {
  "@/utils/controllers/notifications/emailTemplates": legacyTemplates,
  "@/utils/htmlEscape": load("src/utils/htmlEscape.ts"),
});
const { renderOnboardingEmail } = layout;
const sharedTemplates = Object.fromEntries(["agentConnected", "agentFirstTask"].map((name) => [
  name, load(`src/lib/onboarding/emails/${name}.ts`, { "./layout": layout }),
]));
const fixtures = JSON.parse(read("tests/fixtures/htpr-7037/onboarding-before.json"));

for (const name of ["welcome", "agentNudge"]) {
  test(`${name} HTML and text remain byte-identical to the captured pre-change output`, () => {
    const { options, output } = fixtures[name];
    assert.deepEqual(renderOnboardingEmail(options), output);
  });
}

test("optional secondary CTA is escaped, appears before the primary, and preserves code and unsubscribe", () => {
  const label = 'Invite <SCRIPT>"&\'';
  const url = 'https://example.test/?invite="&team=1';
  const unsubscribeUrl = 'https://example.test/?unsubscribe="&user=1';
  const options = {
    subject: "Subject", heading: "Heading", paragraphs: ["Run this", "Then review"], code: "claude mcp add",
    cta: { label: "Review", url: "https://example.test/task" }, secondaryCta: { label, url }, unsubscribeUrl,
  };
  const email = renderOnboardingEmail(options);
  const dom = new JSDOM(email.html);
  try {
    const document = dom.window.document;
    const secondary = document.querySelector("a.secondary-cta");
    assert.equal(secondary.textContent, label);
    assert.equal(secondary.getAttribute("href"), url);
    assert.equal(document.querySelector("a.cta").textContent, "Review");
    assert.equal(document.querySelectorAll("a.cta").length, 1);
    assert.ok(email.html.indexOf('class="secondary-cta"') < email.html.indexOf('class="cta"'));
    assert.equal(label.toLowerCase().includes("<script"), true);
    assert.equal(email.html.toLowerCase().includes("<script"), false);
    assert.ok(email.html.includes("Invite &lt;SCRIPT&gt;&quot;&amp;&#39;"));
    assert.ok(email.html.includes('href="https://example.test/?invite=&quot;&amp;team=1"'));
    assert.equal(document.querySelector(".onboarding-code code").textContent, options.code);
    assert.equal([...document.querySelectorAll("a")].find((link) => link.textContent === "Unsubscribe").getAttribute("href"), unsubscribeUrl);
    assert.equal(email.text, ["Heading", "Run this", options.code, "Then review", `${label}: ${url}`, "Review: https://example.test/task", `Unsubscribe: ${unsubscribeUrl}`].join("\n\n"));
  } finally { dom.window.close(); }
});

for (const [file, name, args, expected] of [
  ["agentConnected", "renderAgentConnectedEmail", ["Claude Code", 42], {
    subject: "Your agent is connected", heading: "Your agent is connected",
    paragraphs: ["Claude Code just talked to Hypertask. Ask your agent to pick up the top task on your board."],
    cta: { label: "Open your board", url: "https://app.hypertask.ai/project?id=42" },
  }],
  ["agentFirstTask", "renderAgentFirstTaskEmail", [{ agentName: "Release agent", taskTitle: "Check the release notes", boardName: "Product team", projectId: 15, uniqueIndex: 7028 }], {
    subject: "Your agent just finished its first task", heading: "Your agent just finished its first task",
    paragraphs: ["Release agent completed 'Check the release notes' on Product team.", "Hypertask works best when your team and your agents share the board."],
    cta: { label: "Review the work", url: "https://app.hypertask.ai/detail/project-15/7028" },
    secondaryCta: { label: "Invite a teammate", url: "https://app.hypertask.ai/project?id=15&invite=1" },
  }],
]) {
  test(`${file} delegates the unchanged copy and links to the shared layout without changing its send payload`, () => {
    let received;
    const renderer = load(`src/lib/onboarding/emails/${file}.ts`, {
      "./layout": { renderOnboardingEmail: (options) => { received = options; return { subject: options.subject, html: "shared HTML", text: "shared text" }; } },
    })[name];
    assert.deepEqual(renderer(...args), { subject: expected.subject, html: "shared HTML" });
    assert.deepEqual(received, expected);
    const actual = sharedTemplates[file][name](...args);
    assert.deepEqual(actual, { subject: expected.subject, html: renderOnboardingEmail(expected).html });
  });
}

test("connected email keeps its original app-home fallback", () => {
  const { renderAgentConnectedEmail } = sharedTemplates.agentConnected;
  for (const boardId of [undefined, 0]) {
    const dom = new JSDOM(renderAgentConnectedEmail("Cursor", boardId).html);
    try { assert.equal(dom.window.document.querySelector("a.cta").getAttribute("href"), "https://app.hypertask.ai"); }
    finally { dom.window.close(); }
  }
});

test("shared email layout has its own feature flag restricted to Owner + QA", async () => {
  const registry = load("src/lib/flags.ts", {
    "@/lib/flags/keys": load("src/lib/flags/keys.ts"),
    "@/lib/flags/definitions": load("src/lib/flags/definitions.ts", {
      "@/lib/flags/keys": load("src/lib/flags/keys.ts"),
      "@/lib/agentRuns/model": {},
    }),
    "@/lib/prisma": { __esModule: true, default: { featureFlag: { findMany: async () => [] } } },
    "@/lib/auth/getSessionUser": {},
    "@/lib/agentRuns/model": {},
  });
  const modes = await registry.listFeatureFlagModes();
  assert.equal(registry.HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG, flag);
  assert.equal(registry.defaultFeatureFlagMode(flag), "OWNER_AND_QA");
  const entry = modes.find((entry) => entry.key === flag);
  assert.equal(entry.kind, "feature");
  assert.equal(entry.shippedOn, "2026-10-09");
  assert.equal(entry.description.includes("\u2014"), false);
});

const legacyFixtures = JSON.parse(read("tests/fixtures/htpr-7037/legacy-agent-emails.json"));

async function sendFixture({ name, args }, mode, recipientUserId) {
  const sent = [];
  const flagReads = [];
  const scheduled = [];
  const email = "recipient@example.invalid";
  const input = args[0];
  const prisma = {
    user: { findUnique: async () => ({ email }) },
    logs: { findFirst: async () => name === "agentConnected"
      ? { id: 1, log: "mcp_connected:fixture", createdAt: new Date(0) } : null },
    project: {
      findFirst: async () => args[1] ? { id: args[1] } : null,
      findUnique: async () => ({ ownerId: recipientUserId, title: input.boardName, owner: { email } }),
    },
    agent: { findFirst: async () => ({ displayName: input.agentName, userId: recipientUserId }) },
    section: { findMany: async () => [
      { id: 1, section_title: "Doing", isDone: false },
      { id: 2, section_title: "Done", isDone: true },
    ] },
    webhookEvent: { create: async () => {}, update: async () => {} },
    $transaction: async (callback) => callback({
      $executeRaw: async () => {},
      logs: { findFirst: async () => null, create: async () => {} },
    }),
  };
  const flags = {
    FEATURE_FLAG_QA_USER_ID: 985,
    HTPR_7026_AGENT_CONNECT_CHECK_FLAG: "htpr-7026-agent-connect-check",
    HTPR_7028_FIRST_TASK_EMAIL_FLAG: "htpr-7028-first-task-email",
    HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG: flag,
    isFeatureEnabled: async (key, userId) => {
      flagReads.push({ key, userId });
      if (key !== flag) return true;
      assert.equal(userId, recipientUserId);
      if (mode === "failure") throw new Error("Flag read unavailable");
      return mode === "on";
    },
  };
  const mocks = {
    "@prisma/client": { LogType: {}, Status: { Normal: "Normal" } },
    "@vercel/functions": { waitUntil: (work) => scheduled.push(work) },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": flags,
    "@/lib/telemetry/activationAnalytics": { trackActivation: async () => {} },
    "@/lib/redis": { getRedis: async () => ({}) },
    "@/lib/onboarding/qaArm": { isOnboardingQaArmed: async () => true },
    "@/lib/email/sendEmail": { sendEmail: async (mail) => sent.push(mail) },
    "@/lib/email/unsubscribe": { unsubscribeHeaders: () => ({ "List-Unsubscribe": "existing-header" }) },
    "@/lib/mcp/boards/columnRole": load("src/lib/mcp/boards/columnRole.ts"),
    "@/lib/onboarding/emails/agentConnected": sharedTemplates.agentConnected,
    "@/lib/onboarding/emails/agentFirstTask": sharedTemplates.agentFirstTask,
    "@/utils/controllers/notifications/emailTemplates": legacyTemplates,
    "./emailTemplates": legacyTemplates,
  };
  if (name === "agentConnected") {
    const client = { "Claude Code": "claude-code", Cursor: "cursor", Codex: "codex" }[input];
    assert.ok(client);
    prisma.logs.findFirst = async () => ({ id: 1, log: `mcp_connected:${client}`, createdAt: new Date(0) });
    await load("src/lib/onboarding/agentConnection.ts", mocks).sendFirstAgentConnectedEmail(recipientUserId, 1);
  } else {
    const before = { id: 1, projectId: input.projectId, uniqueIndex: input.uniqueIndex, title: input.taskTitle, sectionId: 1, section: "Doing", status: "Normal" };
    load("src/utils/controllers/notifications/agentFirstTaskEmail.ts", mocks)
      .scheduleAgentFirstTaskEmail(before, { ...before, sectionId: 2, section: "Done" }, recipientUserId, "agent");
    await Promise.all(scheduled);
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, email);
  assert.equal(sent[0].from, "Hypertask <notifications@hypertask.ai>");
  assert.deepEqual(flagReads.filter(({ key }) => key === flag), [{ key: flag, userId: recipientUserId }]);
  if (name === "agentConnected") {
    assert.deepEqual(flagReads[0], { key: flags.HTPR_7026_AGENT_CONNECT_CHECK_FLAG, userId: 985 });
  } else {
    assert.deepEqual(sent[0].headers, { "List-Unsubscribe": "existing-header" });
  }
  return { subject: sent[0].subject, html: sent[0].html };
}

for (const [index, fixture] of legacyFixtures.cases.entries()) {
  const rendererName = `render${fixture.name[0].toUpperCase()}${fixture.name.slice(1)}Email`;
  test(`${fixture.name} legacy renderer matches captured production bytes, case ${index}`, () => {
    assert.deepEqual(legacyTemplates[rendererName](...fixture.args), fixture.output);
  });
  for (const mode of ["off", "failure", "on"]) {
    test(`${fixture.name} sender selects ${mode} rendering per recipient, case ${index}`, async () => {
      for (const userId of [6, 985, 2343]) {
        const output = await sendFixture(fixture, mode, userId);
        if (mode === "on") {
          assert.deepEqual(output, sharedTemplates[fixture.name][rendererName](...fixture.args));
          assert.notEqual(output.html, fixture.output.html);
        } else {
          assert.deepEqual(output, fixture.output);
        }
      }
    });
  }
}
