const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHmac } = require("node:crypto");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/slack-integration-jiti-entry-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

test("extracts ticket refs and task URLs without duplicates", () => {
  const { extractSlackTaskReferences } = loadTs(
    "src/lib/slack/references.ts",
  );
  const refs = extractSlackTaskReferences(
    "HTPR-123 and HTPR-123 plus https://app.hypertask.ai/detail/project-15/4370 and app.hypertask.ai/detail/project-16/99",
  );

  assert.deepEqual(refs.ticketNumbers, ["HTPR-123"]);
  assert.deepEqual(refs.taskUrls, [
    { projectId: 15, uniqueIndex: 4370 },
    { projectId: 16, uniqueIndex: 99 },
  ]);
});

test("rejects task matches from another Hypertask team", () => {
  const { filterSlackTaskIdsForTeam } = loadTs(
    "src/lib/slack/references.ts",
  );

  assert.deepEqual(
    filterSlackTaskIdsForTeam(
      [
        { id: 1, project: { teamId: "team-a" } },
        { id: 2, project: { teamId: "team-b" } },
        { id: 3, project: { teamId: null } },
      ],
      "team-a",
    ),
    [1],
  );
});

test("verifies Slack v0 signatures with replay protection", () => {
  const { verifySlackSignature } = loadTs("src/lib/slack/signature.ts");
  const secret = "slack-signing-secret";
  const nowMs = 1_800_000_000_000;
  const timestamp = String(Math.floor(nowMs / 1000));
  const body = JSON.stringify({ type: "event_callback" });
  const signature =
    "v0=" +
    createHmac("sha256", secret)
      .update(`v0:${timestamp}:${body}`, "utf8")
      .digest("hex");

  assert.equal(
    verifySlackSignature(body, signature, timestamp, secret, nowMs),
    true,
  );
  assert.equal(
    verifySlackSignature(`${body}x`, signature, timestamp, secret, nowMs),
    false,
  );
  assert.equal(
    verifySlackSignature(body, signature, String(Number(timestamp) - 301), secret, nowMs),
    false,
  );
  assert.equal(verifySlackSignature(body, signature, timestamp, undefined, nowMs), false);
});

test("Slack OAuth state is signed, team-bound, and short-lived", () => {
  const { createSlackOAuthState, verifySlackOAuthState } = loadTs(
    "src/lib/slack/oauthState.ts",
  );
  const secret = "slack-client-secret";
  const nowMs = 1_800_000_000_000;
  const state = createSlackOAuthState(
    { teamId: "team-a", userId: 42 },
    secret,
    nowMs,
  );

  assert.deepEqual(verifySlackOAuthState(state, secret, nowMs), {
    expiresAt: nowMs + 10 * 60 * 1000,
    issuedAt: nowMs,
    teamId: "team-a",
    userId: 42,
    version: 1,
  });
  assert.equal(verifySlackOAuthState(`${state}x`, secret, nowMs), null);
  assert.equal(verifySlackOAuthState(state, "wrong-secret", nowMs), null);
  assert.equal(
    verifySlackOAuthState(state, secret, nowMs + 10 * 60 * 1000 + 1),
    null,
  );
});

test("summarizes only idle threads with newer messages", () => {
  const { needsSlackThreadSummary } = loadTs("src/lib/slack/idle.ts");
  const nowMs = 1_800_000_000_000;
  const idleTs = String((nowMs - 31 * 60 * 1000) / 1000);
  const activeTs = String((nowMs - 29 * 60 * 1000) / 1000);

  assert.equal(
    needsSlackThreadSummary(
      { lastMessageTs: idleTs, lastSummarizedTs: null },
      nowMs,
    ),
    true,
  );
  assert.equal(
    needsSlackThreadSummary(
      { lastMessageTs: activeTs, lastSummarizedTs: null },
      nowMs,
    ),
    false,
  );
  assert.equal(
    needsSlackThreadSummary(
      { lastMessageTs: idleTs, lastSummarizedTs: idleTs },
      nowMs,
    ),
    false,
  );
  assert.equal(
    needsSlackThreadSummary(
      { lastMessageTs: idleTs, lastSummarizedTs: String(Number(idleTs) - 1) },
      nowMs,
    ),
    true,
  );
});

test("detects only explicit Slack task-creation intents", () => {
  const { hasSlackCreateTaskIntent } = loadTs(
    "src/lib/slack/taskCreateIntent.ts",
  );

  for (const text of [
    "<@U123> create a task for this",
    "<@U123> make a ticket: fix the login redirect",
    "Please add this discussion as a task",
    "open a detailed ticket from the thread",
    "write a follow-up task",
  ]) {
    assert.equal(hasSlackCreateTaskIntent(text), true, text);
  }
  for (const text of [
    "I created a task yesterday",
    "The task creator is broken",
    "<@U123> summarize this thread",
    "Please create a project note",
    "Can you open HTPR-4370?",
  ]) {
    assert.equal(hasSlackCreateTaskIntent(text), false, text);
  }
});

test("returns the setup reply instead of creating without a default project", () => {
  const { missingSlackDefaultProjectReply, SLACK_DEFAULT_PROJECT_REPLY } = loadTs(
    "src/lib/slack/taskCreateIntent.ts",
  );

  assert.equal(missingSlackDefaultProjectReply(null), SLACK_DEFAULT_PROJECT_REPLY);
  assert.equal(missingSlackDefaultProjectReply(15), null);
});

test("claims a Slack event only once", async () => {
  const { claimSlackEventOnce } = loadTs(
    "src/lib/slack/taskCreateIntent.ts",
  );
  const eventIds = new Set();
  const client = {
    slackEventReceipt: {
      async create({ data }) {
        if (eventIds.has(data.eventId)) throw { code: "P2002" };
        eventIds.add(data.eventId);
      },
    },
  };

  assert.equal(await claimSlackEventOnce(client, "Ev123"), true);
  assert.equal(await claimSlackEventOnce(client, "Ev123"), false);
  assert.equal(eventIds.size, 1);
});

test("parses Slack commands and quoted flags compatibly", () => {
  const { parseSlackCommand } = loadTs("src/lib/slack/commands.ts");

  assert.deepEqual(
    parseSlackCommand(
      'create "Fix login redirect" --project "Web App" --priority high --status Normal --assignee me --section "In Progress" --title "New title" --description "Full context"',
    ),
    {
      subcommand: "create",
      args: {
        _: "Fix login redirect",
        project: "Web App",
        priority: "high",
        status: "Normal",
        assignee: "me",
        section: "In Progress",
        title: "New title",
        description: "Full context",
      },
    },
  );
  assert.deepEqual(parseSlackCommand(""), {
    subcommand: "help",
    args: { _: "" },
  });
});

test("refuses unlinked Slack users without executing an action", async () => {
  const { runAsLinkedSlackUser } = loadTs("src/lib/slack/authorization.ts");
  let executed = false;
  const result = await runAsLinkedSlackUser(null, async () => {
    executed = true;
    return [];
  });

  assert.equal(result.authorized, false);
  assert.equal(executed, false);
  assert.match(JSON.stringify(result.blocks), /\/ht connect/);
});

test("Slack action rate limits fail closed after the per-minute allowance", () => {
  const {
    isSlackActionRateLimited,
    SLACK_ACTION_RATE_LIMIT,
  } = loadTs("src/lib/slack/rateLimit.ts");

  assert.equal(isSlackActionRateLimited(SLACK_ACTION_RATE_LIMIT), false);
  assert.equal(isSlackActionRateLimited(SLACK_ACTION_RATE_LIMIT + 1), true);
  assert.equal(isSlackActionRateLimited(Number.NaN), true);
});

test("auto-match requires a confirmed Slack email and one team match", () => {
  const { selectConfirmedUniqueTeamMember } = loadTs(
    "src/lib/slack/userLink.ts",
  );
  const members = [
    { id: 1, email: "user@example.com", verified: true },
    { id: 2, email: "other@example.com", verified: true },
  ];

  assert.equal(
    selectConfirmedUniqueTeamMember(
      { is_email_confirmed: false, profile: { email: "user@example.com" } },
      members,
    ),
    null,
  );
  assert.deepEqual(
    selectConfirmedUniqueTeamMember(
      { is_email_confirmed: true, profile: { email: "USER@example.com" } },
      members,
    ),
    members[0],
  );
  assert.equal(
    selectConfirmedUniqueTeamMember(
      { is_email_confirmed: true, profile: { email: "user@example.com" } },
      [...members, { id: 3, email: "USER@example.com", verified: true }],
    ),
    null,
  );
  assert.equal(
    selectConfirmedUniqueTeamMember(
      { is_email_confirmed: true, profile: { email: "user@example.com" } },
      [{ id: 1, email: "user@example.com", verified: false }],
    ),
    null,
  );
});

test("Slack link state and two-party confirmation are signed, expiring, and single use", async () => {
  const {
    consumeSlackLinkConfirmation,
    consumeSlackLinkState,
    createSlackLinkConfirmation,
    createSlackLinkState,
    verifySlackLinkConfirmation,
    verifySlackLinkState,
  } = loadTs("src/lib/slack/linkState.ts");
  const nowMs = 1_800_000_000_000;
  const secret = "slack-client-secret";
  const state = createSlackLinkState(
    { installId: "install-a", slackUserId: "U123" },
    secret,
    nowMs,
    "fixed-nonce",
  );
  const claims = new Set();
  const claimOnce = async (id) => {
    if (claims.has(id)) return false;
    claims.add(id);
    return true;
  };

  assert.deepEqual(verifySlackLinkState(state, secret, nowMs), {
    expiresAt: nowMs + 10 * 60 * 1000,
    installId: "install-a",
    issuedAt: nowMs,
    nonce: "fixed-nonce",
    slackUserId: "U123",
    version: 1,
  });
  assert.ok(await consumeSlackLinkState(state, secret, claimOnce, nowMs));
  assert.equal(await consumeSlackLinkState(state, secret, claimOnce, nowMs), null);
  assert.equal(
    verifySlackLinkState(state, secret, nowMs + 10 * 60 * 1000 + 1),
    null,
  );

  const confirmation = createSlackLinkConfirmation(
    { installId: "install-a", slackUserId: "U123", userId: 42 },
    secret,
    nowMs,
    "confirmation-nonce",
  );
  assert.deepEqual(verifySlackLinkConfirmation(confirmation, secret, nowMs), {
    expiresAt: nowMs + 10 * 60 * 1000,
    installId: "install-a",
    issuedAt: nowMs,
    nonce: "confirmation-nonce",
    slackUserId: "U123",
    userId: 42,
    version: 2,
  });
  assert.equal(verifySlackLinkState(confirmation, secret, nowMs), null);
  assert.ok(
    await consumeSlackLinkConfirmation(
      confirmation,
      secret,
      claimOnce,
      nowMs,
    ),
  );
  assert.equal(
    await consumeSlackLinkConfirmation(
      confirmation,
      secret,
      claimOnce,
      nowMs,
    ),
    null,
  );
});

test("Slack writes require a linked actor and authorized project", () => {
  const eventsRoute = fs.readFileSync(
    path.join(root, "src/app/api/slack/events/route.ts"),
    "utf8",
  );
  const taskCreate = fs.readFileSync(
    path.join(root, "src/lib/slack/taskCreate.ts"),
    "utf8",
  );
  const actions = fs.readFileSync(
    path.join(root, "src/lib/slack/actions.ts"),
    "utf8",
  );

  assert.match(eventsRoute, /slackUserId: event\.user/);
  assert.match(taskCreate, /resolveSlackActor\(event\.slackTeamId, event\.slackUserId\)/);
  assert.match(taskCreate, /getProjectWhere\(actor\.user\.id\)/);
  assert.match(taskCreate, /userId: actor\.user\.id/);
  assert.doesNotMatch(taskCreate, /generalConfig\.hyperAiId/);
  assert.match(actions, /accessibleProjects\.has\(notification\.task\.projectId\)/);
  assert.match(actions, /project: accessibleProjectWhere\(actor\)/);
});

test("Slack project scope keeps the install's team even though getProjectWhere carries its own teamId", () => {
  const { slackAccessibleProjectWhere } = loadTs("src/lib/slack/projectScope.ts");

  const where = slackAccessibleProjectWhere("team-a", 42);

  // The install's team must survive composition. A spread would replace
  // `teamId: "team-a"` with getProjectWhere's `teamId: { not: null }`,
  // exposing every other team this user belongs to.
  assert.ok(Array.isArray(where.AND), "composition must use AND, not a spread");
  const teamClause = where.AND.find((clause) => clause.teamId === "team-a");
  assert.ok(teamClause, "the install's teamId must still be enforced");
  assert.equal(teamClause.status, "Normal");

  // Under Prisma AND semantics every clause applies, so the pinned team is
  // enforced regardless of the "any team" clause getProjectWhere contributes.
  assert.equal(
    where.AND.filter((clause) => clause.teamId === "team-a").length,
    1,
    "exactly one clause must pin the install's team",
  );
  assert.equal(where.teamId, undefined, "no top-level teamId to be overwritten");
});

test("no Slack module spreads getProjectWhere over a team filter", () => {
  const dir = path.join(root, "src/lib/slack");
  const offenders = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) =>
      /\.\.\.getProjectWhere\(/.test(fs.readFileSync(path.join(dir, name), "utf8")),
    );

  assert.deepEqual(
    offenders,
    [],
    "getProjectWhere must be AND-composed; spreading it drops the install's teamId",
  );
});

test("Slack task data responses stay private to the requesting member", () => {
  const commandHandler = fs.readFileSync(
    path.join(root, "src/lib/slack/commandHandler.ts"),
    "utf8",
  );
  const chat = fs.readFileSync(
    path.join(root, "src/lib/slack/chat.ts"),
    "utf8",
  );

  assert.match(
    commandHandler,
    /postSlackResponseUrl\(\s*payload\.responseUrl,\s*authorized\.blocks,\s*true,/,
  );
  assert.match(chat, /postSlackEphemeralMessage\(/);
});

test("routes create-task mentions before chat and handles DMs and assistant threads", () => {
  const { routeSlackEvent } = loadTs("src/lib/slack/eventRouting.ts");

  assert.equal(
    routeSlackEvent({
      type: "app_mention",
      channel: "C1",
      ts: "1.0",
      user: "U1",
      text: "<@BOT> create a task from this thread",
    }),
    "create_task",
  );
  assert.equal(
    routeSlackEvent({
      type: "app_mention",
      channel: "C1",
      ts: "2.0",
      user: "U1",
      text: "<@BOT> show my tasks",
    }),
    "general_chat",
  );
  assert.equal(
    routeSlackEvent({
      type: "message",
      channel_type: "im",
      channel: "D1",
      ts: "3.0",
      user: "U1",
      text: "list projects",
    }),
    "general_chat",
  );
  assert.equal(
    routeSlackEvent({
      type: "assistant_thread_started",
      assistant_thread: { channel_id: "D1", thread_ts: "4.0" },
    }),
    "assistant_welcome",
  );
});

test("scopes Slack-created tickets to the install's Hypertask team", () => {
  const { slackCreateProjectWhere } = loadTs(
    "src/lib/slack/taskCreateIntent.ts",
  );

  assert.deepEqual(slackCreateProjectWhere(15, "team-a"), {
    id: 15,
    status: "Normal",
    teamId: "team-a",
  });
});

test("requires the configured bearer secret for Slack cron requests", () => {
  const { hasValidCronAuthorization } = loadTs(
    "src/lib/cronAuthorization.ts",
  );

  assert.equal(hasValidCronAuthorization("Bearer secret", "secret"), true);
  assert.equal(hasValidCronAuthorization("Bearer wrong", "secret"), false);
  assert.equal(hasValidCronAuthorization(null, "secret"), false);
  assert.equal(hasValidCronAuthorization("Bearer undefined", undefined), false);
});

test("truncates Slack transcripts from the head and keeps recent messages", () => {
  const {
    MAX_SLACK_THREAD_PAGES,
    MAX_SLACK_TRANSCRIPT_CHARACTERS,
    SLACK_TRANSCRIPT_TRUNCATION_NOTICE,
    truncateSlackTranscript,
  } = loadTs("src/lib/slack/threadSummary.ts");
  const transcript = `oldest-message\n${"x".repeat(20_000)}\nnewest-message`;
  const truncated = truncateSlackTranscript(transcript);

  assert.equal(MAX_SLACK_THREAD_PAGES, 5);
  assert.equal(truncated.length, MAX_SLACK_TRANSCRIPT_CHARACTERS);
  assert.equal(truncated.startsWith(`${SLACK_TRANSCRIPT_TRUNCATION_NOTICE}\n`), true);
  assert.equal(truncated.includes("oldest-message"), false);
  assert.equal(truncated.endsWith("newest-message"), true);
});

test("Slack manifest covers commands, chat events, and required scopes", () => {
  const installRoute = fs.readFileSync(
    path.join(root, "src/app/api/slack/install/route.ts"),
    "utf8",
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "docs/slack-app-manifest.json"), "utf8"),
  );
  const scopes = manifest.oauth_config.scopes.bot;
  const events = manifest.settings.event_subscriptions.bot_events;

  for (const scope of [
    "app_mentions:read",
    "assistant:write",
    "channels:history",
    "chat:write",
    "commands",
    "groups:history",
    "im:history",
    "team:read",
    "users:read",
    "users:read.email",
  ]) {
    assert.ok(scopes.includes(scope), scope);
    assert.match(installRoute, new RegExp(`"${scope.replace(".", "\\.")}"`));
  }
  assert.equal(
    manifest.features.slash_commands[0].url,
    "https://app.hypertask.ai/api/slack/commands",
  );
  assert.ok(events.includes("message.im"));
  assert.ok(events.includes("assistant_thread_started"));
});

test("Slack summaries skip relation side effects", () => {
  const cronRoute = fs.readFileSync(
    path.join(root, "src/app/api/cron/slack-thread-summaries/route.ts"),
    "utf8",
  );
  const cleanupCronRoute = fs.readFileSync(
    path.join(root, "src/app/api/cron/cleanup-guests/route.ts"),
    "utf8",
  );
  assert.match(cronRoute, /processTaskReferences: false/);
  assert.doesNotMatch(cronRoute, /x-vercel-cron/);
  assert.doesNotMatch(cleanupCronRoute, /x-vercel-cron/);
});
