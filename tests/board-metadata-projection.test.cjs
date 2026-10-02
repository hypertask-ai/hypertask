const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { Prisma } = require("@prisma/client");

const root = path.resolve(__dirname, "..");

function loadBoardController(prisma) {
  const cache = new Map();
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/tasks/attachOpenBlockingTasks": {
      attachOpenBlockingTasks: async (tasks) => tasks,
    },
    "@/utils/controllers/tasks/attachWaitingOnUsers": {
      attachWaitingOnUsers: async (tasks) => tasks,
    },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const javascript = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => {
        if (stubs[request]) return stubs[request];
        if (request.startsWith("@/")) {
          return load(path.join(root, "src", `${request.slice(2)}.ts`));
        }
        if (request.startsWith(".")) {
          return load(path.resolve(path.dirname(file), `${request}.ts`));
        }
        return require(request);
      },
    );
    return mod.exports;
  }
  return load(path.join(root, "src/utils/controllers/projects/getBoardTasks.ts")).default;
}

async function boardQuery() {
  let query;
  const getBoardTasks = loadBoardController({
    project: {
      findFirst: async (args) => {
        query = args;
        return { id: 15, project_view: { allViews: [{ id: "saved-view" }] } };
      },
    },
    task: { findMany: async () => [{ id: 101 }] },
  });
  const result = await getBoardTasks(15, 6, 6);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.tasks, [{ id: 101 }]);
  assert.deepEqual(result.json.allViews, [{ id: "saved-view" }]);
  return query;
}

test("real board query excludes hidden project text and keeps every other project scalar", async () => {
  const query = await boardQuery();
  assert.ok(query.select, "board metadata must use an explicit projection");
  assert.equal(query.include, undefined);
  const project = Prisma.dmmf.datamodel.models.find((model) => model.name === "Project");
  for (const field of project.fields.filter((field) => field.kind !== "object")) {
    if (["description", "playbook"].includes(field.name)) {
      assert.equal(query.select[field.name], undefined, `${field.name} must not load`);
    } else {
      assert.equal(query.select[field.name], true, `${field.name} must remain`);
    }
  }
  for (const relation of ["members", "owner", "_count", "section", "cycles", "project_view"]) {
    assert.ok(query.select[relation], `${relation} must remain`);
  }
  assert.deepEqual(query.select.section.where, { deleted: false });
  assert.deepEqual(query.select.members.where.OR[1], {
    agent: { OR: [{ userId: 6 }, { visibility: "TEAM" }] },
  });
  assert.deepEqual(query.select.project_view.include.user_project_views.where, { userId: 6 });
});

test("real board query trims unused team and billing columns without changing entitlement inputs", async () => {
  const query = await boardQuery();
  const team = query.select?.team?.select;
  assert.ok(team, "board team must use an explicit projection");
  for (const field of ["description", "survey", "aiProviderSettings"]) {
    assert.equal(team[field], undefined, `${field} must not load`);
  }
  for (const field of ["id", "title", "totalSeats", "googleAccountId", "stripe_customer_id", "activeSubscriptionPlanId", "compedUntil", "allowedEmailDomains"]) {
    assert.equal(team[field], true, `${field} must remain`);
  }
  assert.deepEqual(team.googleAccount, { select: { userId: true } });
  assert.deepEqual(team.team_activity, { select: { hasCompletedTrial: true } });
  assert.deepEqual(team.byokApiKeys.select, { provider: true, enabled: true });
  assert.deepEqual(team.subscriptionPlan.select, {
    priceId: true,
    subscriptionId: true,
    subscriptionStatus: true,
  });
  // Entitlement recovery scans older rows when the active pointer is stale.
  assert.equal(team.subscriptionPlan.take, undefined);
  assert.equal(team.subscriptionPlan.where, undefined);
  assert.deepEqual(team.subscriptionPlan.orderBy, { subscriptionStaretdAt: "desc" });
  assert.deepEqual(query.select.ai_custom_instructions.select, {
    id: true,
    model_selected: true,
    source_selected: true,
    customInstruction: true,
  });
});
