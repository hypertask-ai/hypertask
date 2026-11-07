const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = require("jiti")(__filename, { interopDefault: true, fsCache: false });
const { emailsIn } = jiti(path.join(root, "src/lib/logging/safeLog.ts"));

function activityDataAssignsMetadata(source) {
  const re = /\.(?:user_Activity|team_Activity)\.(?:create|update|upsert|updateMany)\([\s\S]{0,500}/g;
  for (const match of source.matchAll(re)) {
    const dataAt = match[0].search(/\bdata\s*:/);
    if (dataAt < 0) continue;
    if (/\bmetadata\s*:/.test(match[0].slice(dataAt, dataAt + 350))) return true;
  }
  return false;
}

function between(source, start, end) {
  const at = source.indexOf(start);
  assert.ok(at >= 0, start);
  const stop = source.indexOf(end, at);
  assert.ok(stop > at, end);
  return source.slice(at, stop);
}

const activityWriters = [
  "src/utils/controllers/users/provisionNewUser.ts",
  "src/utils/controllers/users/completeOnboardingStep.ts",
  "src/pages/api/teams/create.ts",
  "src/lib/demo/provisionGuest.ts",
  "src/pages/api/activity/addLastActiveAt.ts",
  "src/utils/controllers/tasks/create.ts",
  "src/utils/controllers/tasks/createTaskCore.ts",
  "src/lib/api/task-writes/create-global-effects.ts",
  "src/utils/controllers/stripe/webhook/onSubscriptionUpdated.ts",
];

test("htpr-7786-log-email-ok", () => {
  const emails = emailsIn({
    displayName: "Ada Lovelace",
    nested: { note: "write ada@example.com please" },
    list: ["bob@example.com", "ada@example.com"],
  });
  assert.deepEqual(emails, ["ada@example.com", "bob@example.com"]);

  const gone = [
    ["src/lib/mcp/operations/tasks/update/operation.ts", "POST ~ requestBody:"],
    ["src/lib/api/task-writes/create-global.ts", "creating task ~ body"],
    ["src/lib/api/task-writes/create-global.ts", "~ description:"],
    ["src/utils/controllers/tasks/create.ts", "create ~ body:"],
    ["src/lib/api/task-writes/create-fullscreen.ts", "createFullScreenTaskAndReturn ~ task:"],
    ["src/pages/api/tasks/createGlobally.ts", "~ task:"],
    ["src/pages/api/queues/AiSummary/generateSummaryAfterUpsertionQueue.ts", "processBatch ~ tasksBatch"],
    ["src/app/api/users/check-verification/route.ts", "console.log('user', user)"],
    ["src/utils/controllers/FCM/index.ts", "firebaseId.slice"],
    ["src/utils/controllers/FCM/index.ts", "sendDataNewCommentFCM ~ device:"],
    ["src/app/api/auth/instant-signup/route.ts", "UTM Data"],
    ["src/utils/controllers/logs/createLog.ts", "data.log:"],
    ["src/utils/controllers/meta/metaEvents.ts", "eventsData:"],
    ["src/pages/api/queues/inboxReminder.ts", 'inboxReminder", req.body'],
    ["src/lib/api/notification-writes/push-status-write.ts", "changePushNotificationStatus"],
    ["src/pages/api/invite/createInviteLink.ts", "invitedUser:"],
  ];
  for (const [file, needle] of gone) {
    assert.equal(read(file).includes(needle), false, `${file} still has ${needle}`);
  }

  for (const file of [
    "src/lib/services/authService.ts",
    "src/app/api/auth/verify-code/route.ts",
    "src/app/api/auth/verify-email-token/route.ts",
  ]) {
    const logged = between(read(file), "User updated successfully", "trialStatus");
    assert.equal(logged.includes("displayName"), false, file);
    assert.equal(logged.includes("email"), true, file);
  }

  const createLog = read("src/utils/controllers/logs/createLog.ts");
  assert.match(createLog, /log:\s*data\.log/);
  assert.match(createLog, /sendFirstAgentConnectedEmail/);
  assert.match(read("src/utils/controllers/members/getAll.ts"), /allEmails/);
  assert.match(read("src/lib/github/userApi.ts"), /accountLogin/);
  assert.match(read("src/lib/github/installAuthority.ts"), /accountLogin/);
  assert.match(read("src/lib/mcp/operations/tasks/update/operation.ts"), /actorId/);
  assert.match(read("src/pages/api/stripe/webhook.ts"), /subscriptionId/);
  assert.doesNotMatch(read("src/utils/controllers/FCM/index.ts"), /firebaseId\.slice/);

  assert.equal(activityDataAssignsMetadata("prisma.user_Activity.create({ data: { userId: 1, metadata: \"note\" } })"), true);
  for (const file of activityWriters) {
    assert.equal(activityDataAssignsMetadata(read(file)), false, file);
  }
});
