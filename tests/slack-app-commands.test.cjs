const test = require("node:test");
const assert = require("node:assert/strict");
const { actor, loadTs } = require("./slack-app-fixtures.cjs");

const { parseSlackCommand, SLACK_HELP_TEXT } = loadTs("src/lib/slack/commands.ts");
const cases = [
  ["create Fix login --project Web --assign me --label bug,ui", "create_task", { title: "Fix login", project: "Web", assignee: "me", labels: ["bug", "ui"] }],
  ["search login --project Web", "search_tasks", { query: "login", project: "Web" }],
  ["list --project Web --assignee me --section Todo --priority high", "list_tasks", { project: "Web", assignee: "me", section: "Todo", priority: "high" }],
  ["view HTPR-10", "get_task", { ticket: "HTPR-10" }],
  ["comment HTPR-10 Please fix this", "add_comment", { ticket: "HTPR-10", content: "Please fix this" }],
  ["assign HTPR-10 me", "assign_user", { ticket: "HTPR-10", username: "me" }],
  ["move HTPR-10 In Progress", "move_task", { ticket: "HTPR-10", section: "In Progress" }],
  ['update HTPR-10 --title "New title" --priority urgent --status Archive', "update_task", { ticket: "HTPR-10", title: "New title", priority: "urgent", status: "Archive" }],
  ["inbox", "list_inbox", {}],
  ["projects", "list_projects", {}],
  ["help", null],
  ["connect", null],
  ["disconnect", null],
];

for (const [text, actionName, params] of cases) {
  test(`/ht ${text.split(" ")[0]} parses and dispatches privately as the real person`, async () => {
    const calls = [];
    const responses = [];
    let removed = false;
    const { handleSlackCommand } = loadTs("src/lib/slack/commandHandler.ts", {
      "@/lib/prisma": { __esModule: true, default: {
        slackInstall: { findUnique: async () => ({ id: actor.installId }) },
        slackUserLink: { deleteMany: async ({ where }) => { assert.deepEqual(where, { installId: actor.installId, slackUserId: actor.slackUserId }); removed = true; } },
      } },
      "@/lib/slack/actions": { executeSlackAction: async (resolvedActor, action) => {
        assert.equal(resolvedActor, actor);
        calls.push(action);
        return [{ type: "section", text: { type: "mrkdwn", text: "Done" } }];
      } },
      "@/lib/slack/userLink": { resolveSlackActor: async () => actor, setSlackAutoLinkDisabled: async (installId, slackUserId, userId) => { assert.equal(installId, actor.installId); assert.equal(slackUserId, actor.slackUserId); assert.equal(userId, null); } },
      "@/lib/slack/rateLimit": { claimSlackActionCapacity: async () => true },
      "@/lib/slack/api": { postSlackResponseUrl: async (...args) => responses.push(args) },
    });
    const parsed = parseSlackCommand(text);
    assert.equal(parsed.subcommand, text.split(" ")[0]);
    assert.ok(SLACK_HELP_TEXT.includes(`/ht ${parsed.subcommand}`));
    await handleSlackCommand({ channelId: "C1", responseUrl: "https://hooks.slack.com/test", slackTeamId: "T1", slackUserId: "U1", text }, "https://app.hypertask.ai");
    if (actionName) {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].action, actionName);
      for (const [key, value] of Object.entries(params)) assert.deepEqual(calls[0].params[key], value);
    } else assert.equal(calls.length, 0);
    assert.equal(removed, parsed.subcommand === "disconnect");
    assert.equal(responses.length, 1);
    assert.equal(responses[0][2], true);
    assert.ok(responses[0][1].length > 0);
    if (parsed.subcommand === "connect") assert.match(JSON.stringify(responses[0][1]), /Connected as/);
  });
}

test("empty commands, case, quoted and escaped arguments are preserved", () => {
  assert.equal(parseSlackCommand(" ").subcommand, "help");
  assert.deepEqual(parseSlackCommand('CREATE "Fix \\"login\\"" --project \'Web App\' --priority HIGH'), {
    subcommand: "create", args: { _: 'Fix "login"', project: "Web App", priority: "HIGH" },
  });
});

test("Block Kit task cards and lists, project and inbox lists retain app links and escape data", () => {
  const { taskCard, taskList, projectList, inboxList } = loadTs("src/lib/slack/blocks.ts");
  const task = { projectId: 15, uniqueIndex: 10, ticketNumber: "HTPR-10", title: "Fix <bad> & login", section: "Todo", priority: "High", boardTitle: "Web", dueDate: "2026-10-03", totalComments: 2 };
  const card = taskCard(task);
  assert.match(JSON.stringify(card), /https:\/\/app\.hypertask\.ai\/detail\/project-15\/10/);
  assert.match(JSON.stringify(card), /&lt;bad&gt; &amp;/);
  assert.equal(card.find((block) => block.type === "actions").elements[0].text.text, "View in Hypertask");
  assert.match(JSON.stringify(taskList([task])), /HTPR-10/);
  assert.match(JSON.stringify(projectList([{ title: "Web <App>", taskCount: 3, memberCount: 2, sections: [{ section_title: "Todo" }] }])), /Web &lt;App&gt;/);
  assert.match(JSON.stringify(inboxList([{ id: 4, task, fromUser: { displayName: "Person" } }])), /Notification ID: `4`/);
  for (const render of [taskList, projectList, inboxList]) {
    assert.ok(render([]).length > 0);
    assert.ok(render(Array(50).fill(render === taskList ? task : render === projectList ? { title: "Web" } : { id: 4, task })).length <= 20);
  }
});

test("unlinked commands never execute and return the connect prompt", async () => {
  const responses = [];
  const { handleSlackCommand } = loadTs("src/lib/slack/commandHandler.ts", {
    "@/lib/slack/actions": { executeSlackAction: () => assert.fail("unlinked write") },
    "@/lib/slack/userLink": { resolveSlackActor: async () => null },
    "@/lib/slack/rateLimit": { claimSlackActionCapacity: async () => true },
    "@/lib/slack/api": { postSlackResponseUrl: async (...args) => responses.push(args) },
  });
  await handleSlackCommand({ channelId: "C1", responseUrl: "https://hooks.slack.com/test", slackTeamId: "T1", slackUserId: "U1", text: "create Fix --project Web" }, "https://app.hypertask.ai");
  assert.match(JSON.stringify(responses), /\/ht connect/);
});
