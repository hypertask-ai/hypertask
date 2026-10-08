const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const base = "fdb5e4e4c84d906dc061b51811b5a80179aa5192";
const cli = process.env.HTPR_6923_CLI_ROOT || "/home/valentin/projects/hypertask-cli-zig";
const legacyHashes = {
  update: "fd86e539628986d289b1a2bcfa7356d99d9fcfa5ac56b6475af1e91ad28c829b",
  move: "513aeab45ad20296fe90f8685e6010ca77527ec998a20bd6c9dd00f3133b3381",
};
const lifecycleHashes = {
  "create": "ac3bf10430d38d203068e2c6f94588275b5f2f4a778cf4163884f8e8a62a31b8",
  "global": "e0fc2c38b61e70aaa8a80a106b2fb52d55b0ddac095c91dfd8e1fe5a6cc8df6e",
  "archive": "c37913de3aaa395f5a45ce66155863ad6670d21f03c2c09037c747dad4e54cb2"
};
function lifecycleLegacySources() {
  const unwrap = (file) => read(file)
    .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
    .replace(/export default withTaskWriteFlag\([\s\S]*?\n\);/, "export default handler;");
  let create = unwrap("src/pages/api/tasks/create.ts")
    .replace('import { createFullScreenTaskAndReturn } from "@/lib/api/task-writes/create-fullscreen";\n', "");
  // Restore only the legacy blank-line padding removed from the moved file.
  const fullscreenPadding = { 17: 16, 35: 12, 62: 8, 68: 4 };
  const fullscreen = read("src/lib/api/task-writes/create-fullscreen.ts").split("\n")
    .map((line, index) => {
      if (!fullscreenPadding[index]) return line;
      assert.equal(line, "", "only blank legacy padding is normalized");
      return " ".repeat(fullscreenPadding[index]);
    })
    .join("\n").split("export const createFullScreenTaskAndReturn")[1];
  create = create.replace('export { createFullScreenTaskAndReturn } from "@/lib/api/task-writes/create-fullscreen";\n', "export const createFullScreenTaskAndReturn" + fullscreen);
  const effects = read("src/lib/api/task-writes/create-global-effects.ts");
  const types = effects.slice(effects.indexOf("type TaskCreatedGlobally"), effects.indexOf("function schedulePostCreateWork("));
  const helpers = effects.slice(effects.indexOf("function schedulePostCreateWork("), effects.indexOf("\nexport {"))
    .replaceAll('"@/pages/api/queues/FAST/generateSummary"', '"../queues/FAST/generateSummary"');
  let global = unwrap("src/pages/api/tasks/createGlobally.ts")
    .replace(/^import \{ schedulePostCreateWork[^\n]+\n/m, "")
    .replace('import { IAgent, ILabel, IUser } from "@/models/model";\n', 'import { IAgent, IEstimate, ILabel, IPriority, ITask, IUser } from "@/models/model";\nimport { waitUntil } from "@vercel/functions";\nimport {\n  ITaskAssignedActivity,\n  ITaskEstimateActivity,\n  ITaskPriorityActivity,\n} from "@/models/ActivityModels.ts";\n')
    .replace('import { getSessionUser }', 'import { assignmentActivityUserSelect } from "@/utils/controllers/activities/createAssignedActivity";\nimport { getSessionUser }')
    .replace("const handler: NextApiHandler", types.replace(/\n$/, "") + "const handler: NextApiHandler")
    .replace("\nexport default handler;", helpers + "\nexport default handler;");
  return { create, global, archive: unwrap("src/pages/api/tasks/(un)archive.ts") };
}
function lifecycle() {
  const sources = lifecycleLegacySources();
  for (const [kind, source] of Object.entries(sources)) {
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), lifecycleHashes[kind], kind + " legacy bytes");
  }
  const route = read("src/lib/api/task-writes/route.ts");
  assert.ok(route.includes("HTPR_6923_APP_ROUTER_WRITES_FLAG"));
  assert.ok(route.includes("if (!enabled || !session || !headers) return legacy(req, res)"));
  for (const [page, handler] of [["create", "create"], ["createGlobally", "create-global"], ["(un)archive", "archive"]]) {
    assert.ok(read(`src/pages/api/tasks/${page}.ts`).includes(`withTaskWriteFlag(handler, "POST"`));
    assert.ok(read(`src/pages/api/tasks/${page}.ts`).includes(`/task-writes/${handler}`));
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/tasks/${page}/route.ts`)), "no URL twin");
  }
  assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources.create + "changed").digest("hex"), lifecycleHashes.create), "pin mutation control");
  console.log("lifecycle verification passed");
}
const projectCoreRoutes = {
  "create": {
    "module": "create",
    "method": "POST",
    "hash": "a9ebbf5249d3ef76026479eefcf86edd4c2c38c1f963666c7c24746380f7b5db",
    "signed": false,
    "named": false
  },
  "update": {
    "module": "update",
    "method": "POST",
    "hash": "7cfb2f6a5202378f01b0d31e0e4a17e26e6045c1f47cf626fdc4b934655134e7",
    "signed": false,
    "named": false
  },
  "archive": {
    "module": "archive",
    "method": "POST",
    "hash": "40585eeceaca720654df44497a937ee629844eb155226415a763334b9a697ad0",
    "signed": false,
    "named": true
  },
  "delete": {
    "module": "delete",
    "method": "POST",
    "hash": "4063fe7de1152798473de9b7d7a0c1a9441d3ccda84827867b7a99a73af16c01",
    "signed": false,
    "named": true
  },
  "leave": {
    "module": "leave",
    "method": "POST",
    "hash": "56a194256bee2e4bbc7edcc30f4d0a7f5e78cecb12dee71b899bddfdd34bc7df",
    "signed": false,
    "named": true
  },
  "removeMember": {
    "module": "remove-member",
    "method": "POST",
    "hash": "9dde2456651fbde80cb9e018a36d18fce510afd3e4314501273c16bebbdeade1",
    "signed": true,
    "named": false
  },
  "setMemberRole": {
    "module": "set-member-role",
    "method": "POST",
    "hash": "028c851d2bb1afd9dc70b1c9b32c5542f85fc0d605fbe350e87284c10f34c4c8",
    "signed": false,
    "named": false
  },
  "boardTasks": {
    "module": "board-read",
    "method": "POST",
    "hash": "0ccc7b872e11f1103e6e6b7b0a596248fb0454a3ddbbca553d58f8ad74fe75a3",
    "signed": false,
    "named": false
  },
  "getAll": {
    "module": "all-read",
    "method": "POST",
    "hash": "56db7430b2c8dd703aa7ffb13d940641dfab95f5141875e1f30b26f7d0e5ec02",
    "signed": true,
    "named": false
  },
  "getAllMinimal": {
    "module": "minimal-read",
    "method": "GET",
    "hash": "7f048fa79af45aa2d6c2bb14a43a6059a876f3f4a7255470a98dc7852b1c6c82",
    "signed": true,
    "named": false
  },
  "getFirst": {
    "module": "first-read",
    "method": "GET",
    "hash": "4bdc73ef2ea6f2ad374cc97a96a759c8cdcdd4d64e8bf2325f8df83b6dc9fc4a",
    "signed": true,
    "named": false
  },
  "getArchived": {
    "module": "archived-read",
    "method": "GET",
    "hash": "e1747ed0c66c96020548c6e21b502fa3b7f84981161a62b99d80421003280408",
    "signed": false,
    "named": false
  },
  "getFavorites": {
    "module": "favorites-read",
    "method": "GET",
    "hash": "049e73589e1e5b07c61aa524f256fc7b7a54b9b25441d804b89fe3b2a1493704",
    "signed": false,
    "named": false
  },
  "lastActivity": {
    "module": "last-activity-read",
    "method": "GET",
    "hash": "5db7f359e2c676bc40ef110a7924fc71753dbd3c062e27d0324b5b7733cb8c4b",
    "signed": false,
    "named": false
  }
};
function projectCoreLegacySources() {
  return Object.fromEntries(Object.entries(projectCoreRoutes).map(([name, { named }]) => {
    let source = read(`src/pages/api/projects/${name}.ts`)
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "");
    source = named
      ? source.slice(0, source.indexOf("\n\nexport default withTaskWriteFlag")).replace("async function handler", "export default async function handler")
      : source.replace(/export default withTaskWriteFlag\([\s\S]*?\n\);/, "export default handler;");
    return [name, source];
  }));
}
function projectCore() {
  const sources = projectCoreLegacySources();
  for (const [name, { module, method, hash }] of Object.entries(projectCoreRoutes)) {
    assert.equal(crypto.createHash("sha256").update(sources[name]).digest("hex"), hash, name + " legacy bytes");
    const page = read(`src/pages/api/projects/${name}.ts`);
    assert.ok(page.includes(`withTaskWriteFlag(handler, "${method}"`));
    assert.ok(page.includes(`/project-writes/${module}`));
    assert.ok(read(`src/lib/api/project-writes/${module}.ts`).includes("taskWriteRoute("));
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/projects/${name}/route.ts`)), "no URL twin");
  }
  assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources.create + "changed").digest("hex"), projectCoreRoutes.create.hash), "pin mutation control");
  console.log("project core verification passed");
}
const slice3Routes = {
  "recoverTask": {
    "module": "recover",
    "method": "POST",
    "hash": "345c9a672ef944ce46895d185d87f64e7defd17265a08725e8f78dea72ac3d29"
  },
  "deleteTask": {
    "module": "delete",
    "method": "DELETE",
    "hash": "d45c197575d3bb033423577d0decdc0f92028a9ee3123a1da236a97d9d17b02e"
  },
  "setDueDate": {
    "module": "due-date",
    "method": "POST",
    "hash": "4857ca934023b79b4065cc3e7dd8ef058f882e2a18062600b35302e842ee525f"
  },
  "setStartDate": {
    "module": "start-date",
    "method": "POST",
    "hash": "d07cc8fdcb98c639e23482d4c16523bf77873442ed8571e00b577928e68cea76"
  },
  "setRecurrence": {
    "module": "recurrence",
    "method": "POST",
    "hash": "3217ca8cb57633e0f2cc5f86d88f5d6f5fa330fc593faf718ef12a4a601810e6"
  },
  "addParent": {
    "module": "add-parent",
    "method": "POST",
    "hash": "e6180619e7f83250629a9b4094b91ce376ab0f29545012955ca20569b21cbfec"
  },
  "removeParent": {
    "module": "remove-parent",
    "method": "POST",
    "hash": "3758ae47ad5c10b47c43b302436058d8113101587b1bf9a6b1e002c9c022853b"
  },
  "addRelations": {
    "module": "add-relations",
    "method": "POST",
    "hash": "b4dabfb101a497d43d9b1f78500dcf2dc1c820b6ec51cd0b3192e3680d968c0c"
  },
  "removeRelation": {
    "module": "remove-relation",
    "method": "POST",
    "hash": "61f845062e293bbaccbbe2a49bc842dcff05c3e12b15e48faa51514a64aff720"
  },
  "waiting-on": {
    "module": "waiting-on",
    "method": "POST",
    "hash": "9c3e0b9650c507251cbc91c7acf350029753e86b75382d200dad6b965c11c7ff"
  },
  "reactToDescription": {
    "module": "description-reaction",
    "method": "POST",
    "hash": "778e00b93cd8ec2a0744b137a32228675ec8494a569a47f10660ad61587bbdfe"
  },
  "linkPullRequest": {
    "module": "link-pull-request",
    "method": "POST",
    "hash": "d81cc3abc8687818dcd24699c629d2a993c21488c4093ffe722ef2c54404ddb3"
  }
};
function slice3LegacySources() {
  return Object.fromEntries(Object.keys(slice3Routes).map((name) => {
    let source = read(`src/pages/api/tasks/${name}.ts`)
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
      .replace(/\n\nexport default withTaskWriteFlag[\s\S]*$/, "");
    if (name === "recoverTask") source = source.replace(" async function handler(", "export default  async function handler(") + "\n";
    else if (name === "deleteTask") source = source.replace("async function handler(", "export default async function handler(") + "\n";
    else if (name === "linkPullRequest") source = source.replace("const handler = createLinkPullRequestHandler(", "export default createLinkPullRequestHandler(") + "\n";
    else source += "\n\nexport default handler;" + (name === "reactToDescription" ? "" : "\n");
    return [name, source];
  }));
}
function slice3() {
  const sources = slice3LegacySources();
  for (const [name, { module, method, hash }] of Object.entries(slice3Routes)) {
    assert.equal(crypto.createHash("sha256").update(sources[name]).digest("hex"), hash, name + " legacy bytes");
    const page = read(`src/pages/api/tasks/${name}.ts`);
    assert.ok(page.includes(`withTaskWriteFlag(handler, "${method}"`));
    assert.ok(page.includes(`/task-writes/${module}`));
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/tasks/${name}/route.ts`)), "no URL twin");
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), hash), "pin mutation control");
  }
  const route = read("src/lib/api/task-writes/route.ts");
  assert.ok(route.includes("HTPR_6923_APP_ROUTER_WRITES_FLAG"));
  assert.ok(route.includes("if (!enabled || !session || !headers) return legacy(req, res)"));
  assert.ok(read("src/pages/api/tasks/linkPullRequest.ts").includes("export function createLinkPullRequestHandler"), "retain exported factory and URL pending external review");
  // Relocated diagnostic strings are not HTTP callers; exclude only those logs.
  const corpora = [filesAt(root, "src"), filesAt(cli, "."), filesAt(root, "e2e")]
    .map(corpus => corpus.map(row => ({ ...row, text: row.text.replace(/console\.(?:warn|error)\("\/api\/tasks\/linkPullRequest[^\n]*/g, "") })));
  for (const corpus of corpora) assert.equal(callerFiles("tasks/linkPullRequest", corpus).length, 0, "PR URL retained despite zero tracked callers");
  assert.throws(() => assert.equal(callerFiles("tasks/linkPullRequest", [{ file: "fixture.ts", text: 'fetch("/api/tasks/linkPullRequest")' }]).length, 0), "absence control detects a live caller");
  console.log("slice3 structural verification passed");
}
const attachmentRoutes = {
  "uploadUrl": {
    "module": "upload-url",
    "method": "POST",
    "hash": "d3faf1aebf825e27bba5cb9f935db38a0ac862576ca1688c1193c64d11ec2e8d"
  },
  "uploadFinalize": {
    "module": "upload-finalize",
    "method": "POST",
    "hash": "01d48f1d642c0d7a64efc47680bf97795a21c6ebba2712345c89183e252683d8"
  },
  "downloadAttachment": {
    "module": "download-attachment",
    "method": "GET",
    "hash": "072e4872015008699263a5de8eac474a9bd205b4db1d5971ec4eca22a4c16ca7"
  }
};
function attachmentLegacySources() {
  return Object.fromEntries(Object.keys(attachmentRoutes).map(name => [name,
    read(`src/pages/api/tasks/${name}.ts`)
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
      .replace(/\n\nexport default withTaskWriteFlag[\s\S]*$/, "\n")
      .replace("async function handler(", "export default async function handler("),
  ]));
}
function attachments() {
  const sources = attachmentLegacySources();
  for (const [name, { module, method, hash }] of Object.entries(attachmentRoutes)) {
    assert.equal(crypto.createHash("sha256").update(sources[name]).digest("hex"), hash, name + " legacy bytes");
    const page = read(`src/pages/api/tasks/${name}.ts`);
    assert.ok(page.includes(`withTaskWriteFlag(handler, "${method}"`));
    assert.ok(page.includes(`/task-writes/${module}`));
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/tasks/${name}/route.ts`)), "no URL twin");
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), hash), "pin mutation control");
  }
  assert.equal(crypto.createHash("sha256").update(read("src/pages/api/tasks/n8nUpload.ts")).digest("hex"), "d314ad36c6533f9386be38b762917c8474bba3ad681a9b475714ab7c0c4d9740", "multipart route stays unchanged");
  assert.ok(read("src/pages/api/tasks/n8nUpload.ts").includes("bodyParser: false"));
  console.log("attachments structural verification passed");
}
const slice5cHashes = {
  "src/pages/api/tasks/getAll.ts": "56e86d106a40a875868233e66ad56474d5701236228f78a9345d427c65761d80",
  "src/utils/controllers/tasks/getAll.ts": "b82c469dbf01bdb976e32a93a35cff0e8b3f3139fb39923913d52c2655dbea89",
  "src/lib/api/task-writes/route.ts": "ede51193ada9ee53a18b8d1b54ab7a6f0a7ac47f0fe98ece94293556cb0faa71",
  "src/lib/api/task-writes/read-query.ts": "0fe62c1d4921f4c389e3901e9058e4905f96ee962e0000ee528ea66febd54409",
};
function slice5cLegacySource() {
  return read("src/pages/api/tasks/getAll.ts")
    .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
    .replace(/export default withTaskWriteFlag\([\s\S]*$/, "export default handler;");
}
function slice5c() {
  const original = JSON.parse(read("tests/fixtures/htpr-6968-slice-5c/getAll.json"));
  assert.equal(slice5cLegacySource(), original, "getAll fallback is byte-identical to independent fixture");
  for (const [file, hash] of Object.entries(slice5cHashes)) {
    const source = file === "src/pages/api/tasks/getAll.ts" ? original : read(file);
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), hash, file + " preserved bytes");
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(source + "changed").digest("hex"), hash), "pin mutation control");
  }
  const page = read("src/pages/api/tasks/getAll.ts");
  assert.ok(page.includes('withTaskWriteFlag(handler, "POST", async () =>'));
  assert.ok(page.includes('(await import("@/lib/api/task-writes/getAll")).POST'));
  assert.ok(read("src/lib/api/task-writes/getAll.ts").includes("taskWriteRoute"));
  assert.ok(!fs.existsSync(path.join(root, "src/app/api/tasks/getAll/route.ts")), "no URL twin");
  const controllerImport = 'import controller from "@/utils/controllers/tasks/getAll";';
  assert.equal(callerFiles("tasks/getAll", [{ file: "fixture.ts", text: controllerImport }]).length, 0, "controller import is not an HTTP caller");
  assert.equal(callerFiles("tasks/getAll", [{ file: "fixture.ts", text: controllerImport + 'fetch("/api/tasks/getAll")' }]).length, 1, "controller exclusion retains real caller control");
  console.log("slice5c structural verification passed; independent fallback, controller and helpers pinned");
}
const slice5Routes = {
  single: { module: "single-read-delete", methods: ["GET", "DELETE"], hash: legacyHashes.update },
  markRead: { module: "mark-read", methods: ["POST"], hash: "5aa66631b3772ce09f2631bea22e6fd23362bedbc4c4745511550b34e4e2f60b" },
  "move-task-to-different-board": { module: "move-to-different-board", methods: ["POST"], hash: "d402863e6c1201860ef1a35fec10e063384633783a92da4311847966f0cbf559" },
};
function slice5LegacySources() {
  return Object.fromEntries(Object.keys(slice5Routes).map(name => [name,
    read(`src/pages/api/tasks/${name}.ts`)
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
      .replace(/export default withTaskWriteFlag\([\s\S]*$/, "export default handler;\n"),
  ]));
}
function slice5() {
  const sources = slice5LegacySources();
  for (const [name, { module, methods, hash }] of Object.entries(slice5Routes)) {
    assert.equal(crypto.createHash("sha256").update(sources[name]).digest("hex"), hash, name + " legacy bytes");
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), hash), "pin mutation control");
    const page = read(`src/pages/api/tasks/${name}.ts`);
    for (const method of methods) {
      assert.ok(page.includes(`"${method}"`));
      assert.ok(page.includes(`(await import("@/lib/api/task-writes/${module}")).${method}`));
      assert.ok(read(`src/lib/api/task-writes/${module}.ts`).includes(`export const ${method}`));
    }
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/tasks/${name}/route.ts`)), "no URL twin");
  }
  slice5c(); // Preserve getAll's independent compatibility policy through slice 5c.
  console.log("slice5 structural verification passed");
}
const slice5bRoutes = {
  "getArchivedTasks": {
    "module": "archived-read",
    "method": "GET",
    "hash": "29952f4bcde2dcef19135af00574a2a1373e03c5c6d6ef4825b081b989299811"
  },
  "getArchivedTasksByProject": {
    "module": "archived-project-read",
    "method": "GET",
    "hash": "9b6efe3cbce75cf692a97b7951ff4a8a5a02c870ed19a92edad04f557c2e24c0"
  },
  "getTask": {
    "module": "task-read",
    "method": "GET",
    "hash": "5c3fe5f24649ad569a849fdef4aea86c70bda630533421e950e100cac5bcb2e9"
  },
  // HTPR-7017: security fixes intentionally replace the unauthenticated read contract.
  "getTaskMinimal": {
    "module": "minimal-read",
    "method": "READ",
    "hash": "7a264c49ca54d680ec33f7fbd27ffb3bfa8943ff173314254a7cd2c25a8ba023"
  },
  "getUnscheduled": {
    "module": "unscheduled-read",
    "method": "GET",
    "hash": "43e09a1683d70787c07a5babc918314c29d9d3a3ea0da491c40d64733d9b15eb"
  },
  "detailMeta": {
    "module": "detail-meta-read",
    "method": "GET",
    "hash": "ab576cb5dbd4a7dd2bd5b7c57ce3866a037aa58dd1cc3b81fa798bc883add40f"
  },
  "searchAll": {
    "module": "search-all",
    "method": "POST",
    "hash": "c53d5edb70cbf2274d49f51dbbb78252de7e4cf592b0cec5f4b1f45825a5622c"
  },
  "searchByParam": {
    "module": "search-by-param",
    "method": "GET",
    "hash": "f517dc658552ffe33d972ce64824c5a9777578e0c64a56d9dcc885a7da7c04c7"
  },
  "searchOrphans": {
    "module": "search-orphans",
    "method": "GET",
    "hash": "5631236d4a484844dd6d15deab0f0ba1644f4e9b0f848dfdc5424206f5632216"
  }
};
function slice5bLegacySources() {
  return Object.fromEntries(Object.keys(slice5bRoutes).map(name => {
    let source = read(`src/pages/api/tasks/${name}.ts`)
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "");
    if (name === "detailMeta") {
      source = source.slice(0, source.indexOf("\nconst flaggedHandler ="))
        .replace("async function handler(", "export default async function handler(");
    } else {
      if (name === "getTask" || name === "getTaskMinimal") {
        const marker = name === "getTask" ? "const flaggedHandler =" : "// Legacy accepts every method";
        source = source.slice(0, source.indexOf(marker)) + "export default handler;\n";
      } else {
        source = source.replace(/export default withTaskWriteFlag\([\s\S]*?\n\);/, "export default handler;");
      }
    }
    return [name, source];
  }));
}
function slice5b() {
  const sources = slice5bLegacySources();
  for (const [name, { module, method, hash }] of Object.entries(slice5bRoutes)) {
    assert.equal(crypto.createHash("sha256").update(sources[name]).digest("hex"), hash, name + " legacy bytes");
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), hash), "pin mutation control");
    const page = read(`src/pages/api/tasks/${name}.ts`);
    assert.ok(page.includes("withTaskWriteFlag("));
    assert.ok(page.includes(`(await import("@/lib/api/task-writes/${module}")).${method}`));
    assert.ok(read(`src/lib/api/task-writes/${module}.ts`).includes(`export const ${method}`));
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/tasks/${name}/route.ts`)), "no URL twin");
  }
  slice5(); // Includes the getAll fallback/controller compatibility pins.
  console.log("slice5b structural verification passed");
}
const projectViewRoutes = {
  "create-view": {
    "methods": [
      "POST"
    ],
    "hash": "5a6c0939ce91e81220e4341f60c7bfb3ed7bfd3b10759b2207ab36eecbcae90b",
    "export": "export default handler;"
  },
  "update-view": {
    "methods": [
      "POST"
    ],
    "hash": "2b3b0dbcfa576f5a36b880a840604456d87afbee3de0e32259489f9c21953dd5",
    "export": "export default handler;"
  },
  "delete-rename-view": {
    "methods": [
      "POST",
      "DELETE"
    ],
    // HTPR-6985 intentionally changes missing-view DELETE errors from 500 to 404.
    "hash": "c0e68cda0ca822dc2c46c23e8314b755d58058288b300b8fe4acec202177ad13",
    "export": "export default handler"
  },
  "switch-view": {
    "methods": [
      "POST"
    ],
    "hash": "4074f0cdba73472d5e4c021f0acbe0f934bf02387834540688325f942fcef9f5",
    "export": "export default handler"
  },
  "unsaved-view": {
    "methods": [
      "POST"
    ],
    "hash": "f717f6eaf695114f3debbadf6267b061bd54adb56efcaea9e45627e17bd7de06",
    "export": "export default handler;"
  },
  "reset-to-default": {
    "methods": [
      "POST"
    ],
    "hash": "b4eded269799550b856001b4ab8a633f0f508a67137b828c4b7bd5866d3dc016",
    "export": "export default handler;"
  },
  "update-order": {
    "methods": [
      "POST"
    ],
    "hash": "5d52aa7ec42d11c28d374f78051e91fbe01b7043507cce29a51fe69b4cd55cd7",
    "export": "export default handler;"
  },
  "reset-order": {
    "methods": [
      "POST"
    ],
    "hash": "9dc200e3f057a283719c252f73506e856e7f6bc7037b22384de6c0c9d261f4ea",
    "export": "export default handler;"
  },
  "set-default-order": {
    "methods": [
      "POST"
    ],
    "hash": "9224d69f050562000e615c15a6e926e1fcd11ad346d263b1288f90790da3dc71",
    "export": "export default handler;"
  },
  "smart-split": {
    "methods": [
      "POST",
      "PATCH",
      "DELETE"
    ],
    "hash": "55b18e41b5fbb0362f16e4aee217ceb06695e97308996a684f275421285674c1",
    "export": "function"
  }
};
function projectViewLegacySources() {
  return Object.fromEntries(Object.entries(projectViewRoutes).map(([name, entry]) => {
    let source = read(`src/pages/api/projects/views/${name}.ts`)
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "");
    if (entry.export === "function") {
      source = source.slice(0, source.indexOf("\nexport default withTaskWriteFlag"))
        .replace("async function handler(", "export default async function handler(");
    } else {
      const start = source.indexOf("export default withTaskWriteFlag");
      const end = source.indexOf("\n", source.indexOf("\n);", start) + 1);
      source = source.slice(0, start) + entry.export + source.slice(end);
    }
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), entry.hash, name + " independent legacy bytes");
    return [name, source];
  }));
}
function projectViews() {
  const sources = projectViewLegacySources();
  for (const [name, { hash, methods }] of Object.entries(projectViewRoutes)) {
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), hash), "pin mutation control");
    const page = read(`src/pages/api/projects/views/${name}.ts`);
    for (const method of methods) {
      assert.ok(page.includes(`(await import("@/lib/api/project-writes/views/${name}")).${method}`));
      assert.ok(read(`src/lib/api/project-writes/views/${name}.ts`).includes(`export const ${method}`));
    }
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/projects/views/${name}/route.ts`)), "no URL twin");
  }
  assert.equal(crypto.createHash("sha256").update(read("src/pages/api/projects/views/sync-view.ts")).digest("hex"), "451a5e8060edeea344f51e405b890ced8d43fb56d87f88711df41b10aa1cc516", "sync-view stays unchanged for slice 12 review");
  const sync = inventory().find(row => row.endpoint === "projects/views/sync-view");
  assert.deepEqual(sync.callers, [0, 0, 0], "sync-view has no tracked app/CLI/e2e callers; external-use review remains slice 12");
  const injected = [{ file: "fixture.ts", text: 'fetch("/api/projects/views/sync-view")' }];
  assert.equal(callerFiles(sync.endpoint, injected).length, 1, "caller scanner positive control");
  assert.throws(() => assert.equal(callerFiles(sync.endpoint, injected).length, 0), "absence control rejects an injected sync-view caller");
  console.log("project views structural verification passed; sync-view callers 0/0/0 (retained)");
}
const sectionRoutes = {
  "create": {
    "module": "create",
    "hash": "7e125e5557cc993bb52cc9c954e10a33845f8e4dd6f1ad7eaf43d8cc4d6e1f67",
    "export": "export default handler"
  },
  "update": {
    "module": "update",
    "hash": "7999c9d4aace14ce7e0776679e295c88434fca5ed029f12c35a24179436f7020",
    "export": "export default handler;"
  },
  "rename": {
    "module": "rename",
    "hash": "df0e36fe621b8e021fb3133f24883a3327d9fd03628c1d963ed91e8d14909658",
    "export": "export default handler;"
  },
  "resetRanks": {
    "module": "reset-ranks",
    "hash": "177a16e061585ac5aca352df5be92dcd292898cafc8cf385319e6c3f4b4a7462",
    "export": "export default handler;"
  },
  "getAll": {
    "module": "get-all",
    "hash": "b77e4b5bde0876ec69d5f1a27a8ca94fc1c1118a9aec46e543839b348d8914a4",
    "export": "export default handler;"
  },
  "getByTaskId": {
    "module": "get-by-task",
    "hash": "f41132ed4a517c2791c552c4f258e1f11f6f4943782a5797226733521ba2ce5a",
    "export": "export default handler;"
  },
  "getProjectSections": {
    "module": "get-project-sections",
    "hash": "620ad2b21d77e3cdf989a16054db78cd877d09df40d968f9b3cd76c0a6851f8b",
    "export": "export default handler;"
  }
};
function sectionLegacySources() {
  return Object.fromEntries(Object.entries(sectionRoutes).map(([name, entry]) => {
    const source = read(`src/pages/api/section/${name}.ts`)
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
      .replace(/export default withTaskWriteFlag\([\s\S]*?\n\);/, entry.export);
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), entry.hash, name + " independent legacy bytes");
    return [name, source];
  }));
}
function sections() {
  const sources = sectionLegacySources();
  const measured = inventory().filter(row => row.endpoint.startsWith("section/"));
  assert.deepEqual(measured.map(row => row.endpoint.split("/")[1]).sort(), Object.keys(sectionRoutes).sort());
  for (const [name, { module, hash }] of Object.entries(sectionRoutes)) {
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), hash), "pin mutation control");
    const page = read(`src/pages/api/section/${name}.ts`);
    assert.ok(page.includes('withTaskWriteFlag(handler, "POST"'));
    assert.ok(page.includes(`(await import("@/lib/api/section-writes/${module}")).POST`));
    assert.ok(read(`src/lib/api/section-writes/${module}.ts`).includes("export const POST"));
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/section/${name}/route.ts`)), "no URL twin");
  }
  for (const name of ["getAll", "getByTaskId"]) {
    const endpoint = "section/" + name;
    assert.deepEqual(measured.find(row => row.endpoint === endpoint).callers, [0, 0, 0], "retain unused reader pending slice 12 external-use review");
    const controllerImport = `import controller from "@/utils/controllers/${endpoint}";`;
    assert.equal(callerFiles(endpoint, [{ file: "fixture.ts", text: controllerImport }]).length, 0, "controller import is not an HTTP caller");
    const injected = [{ file: "fixture.ts", text: controllerImport + `fetch("/api/${endpoint}")` }];
    assert.equal(callerFiles(endpoint, injected).length, 1, "caller scanner positive control");
    assert.throws(() => assert.equal(callerFiles(endpoint, injected).length, 0), "absence checker rejects an injected caller");
  }
  console.log("section structural verification passed; seven shells retained");
}
const notificationRoutes = {
  "(un)archiveBulk": {
    "module": "archive-bulk",
    "method": "POST",
    "path": "src/pages/api/notifications/(un)archiveBulk.ts",
    "hash": "a3552ed3b0d610be8ff01133f3839b551d479856d2783469b5a2c266d24818ac"
  },
  "getByTask": {
    "module": "task-seen",
    "method": "POST",
    "path": "src/pages/api/notifications/getByTask.ts",
    "hash": "60d91acda72716a25a5d6b1c0f03d8fdf4ce40a54fb0af8466299db5eb29fbf5"
  },
  "markAsDone": {
    "module": "mark-done",
    "method": "GET",
    "path": "src/pages/api/notifications/markAsDone.ts",
    "hash": "494077913e306f9772a9ca3c32796c86c680e6fe05d10d90ce82b678a525e76f"
  },
  "markAsUnseen": {
    "module": "mark-unseen",
    "method": "GET",
    "path": "src/pages/api/notifications/markAsUnseen.ts",
    "hash": "1b2c530228c8d259705a5388388078b11c527cc310820bbecd7331f1c43d5e0f"
  },
  "moveTaskToInbox": {
    "module": "move-task-to-inbox",
    "method": "POST",
    "path": "src/pages/api/notifications/moveTaskToInbox.ts",
    "hash": "f38ecba037e7cdffdf65c20fedb444e746f6fafe42e5e92768e5c776f0900322"
  },
  "sendEmailToFollower": {
    "module": "follower-email",
    "method": "POST",
    "path": "src/pages/api/notifications/sendEmailToFollower.ts",
    "hash": "0458ba3de29a382ab4bb7d79abed74f85bd89a7b6063fa1633bed1f0371952a3"
  },
  "unArchiveNotificationById": {
    "module": "unarchive-by-id",
    "method": "POST",
    "anyMethod": true,
    "path": "src/pages/api/notifications/unArchiveNotificationById.ts",
    "hash": "310f19f6da5f0741cade25d21ee04bd4d3aa9d3acc26888b76609c891830d9a4"
  },
  // HTPR-7017: require board access and scope comment IDs to the authorized task.
  "updateSeen": {
    "module": "comments-seen",
    "method": "POST",
    "domain": "comments",
    "path": "src/pages/api/comments/updateSeen.ts",
    "hash": "c50eb838fc0f003012674e843229d3e08e1a80b0b00f08d71535d57d85a55568"
  }
};
function notificationLegacySources() {
  return Object.fromEntries(Object.entries(notificationRoutes).map(([name, entry]) => {
    const fixture = JSON.parse(read(`tests/fixtures/htpr-6968/slice-10/${name}.legacy.json`));
    assert.equal(crypto.createHash("sha256").update(fixture).digest("hex"), entry.hash, name + " fixture bytes");
    let source = read(entry.path).replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "");
    if (entry.anyMethod) {
      source = source.replace('async function handler(', 'export default  async function handler(')
        .replace("import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'", "import type { NextApiRequest, NextApiResponse } from 'next'");
      source = source.slice(0, source.indexOf('\n\nexport default ((req, res)'));
    } else {
      source = source.replace(/export default withTaskWriteFlag\([\s\S]*?\n\);/, "export default handler;");
    }
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), entry.hash, name + " legacy fallback bytes");
    assert.equal(source, fixture, name + " independent original fixture");
    return [name, fixture];
  }));
}
const notificationDeferredHashes = {
  "src/pages/api/projects/views/sync-view.ts": "451a5e8060edeea344f51e405b890ced8d43fb56d87f88711df41b10aa1cc516",
  "src/pages/api/projects/detail.ts": "ae86b4e8ee6555a57bfb8080c58172b9783b2a875ac6c9df4c124f62def4cf6f",
  "src/pages/api/tasks/getAll.ts": "56e86d106a40a875868233e66ad56474d5701236228f78a9345d427c65761d80",
  "src/pages/api/tasks/n8nUpload.ts": "d314ad36c6533f9386be38b762917c8474bba3ad681a9b475714ab7c0c4d9740",
  "src/utils/controllers/notifications/getByTask.ts": "34e1ea9d71f7c2c716724bb777cfb26de4b60ee3d93617a0e7e7c19dc1c67e14",
  "src/lib/taskCardActions/inboxState.ts": "6aae12f9bdb428064e65b9d2fc54d25b7b28fead43ca05ae0e285b8a137ec8ee",
  "src/utils/controllers/notifications/sendMentionEmail.ts": "c76347bba0b559e289c830318d936c25353f46643451cbbf023a586d3e5886b0"
};
function notifications() {
  const sources = notificationLegacySources();
  for (const [file, hash] of Object.entries(notificationDeferredHashes)) {
    const source = file === "src/pages/api/tasks/getAll.ts" ? slice5cLegacySource() : read(file);
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), hash, file + " deliberately unchanged");
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(source + "changed").digest("hex"), hash), "deferred pin mutation control");
  }
  const controllerImport = 'import controller from "@/utils/controllers/notifications/getByTask";';
  assert.equal(callerFiles("notifications/getByTask", [{ file: "fixture.ts", text: controllerImport }]).length, 0);
  assert.equal(callerFiles("notifications/getByTask", [{ file: "fixture.ts", text: controllerImport + 'fetch("/api/notifications/getByTask")' }]).length, 1, "controller exclusion retains actual HTTP caller control");
  const doc = read("docs/htpr-6509-slices.md");
  const assigned = [...doc.matchAll(/^\| `(src\/pages\/api\/[^`]+)` \| 10 \|/gm)].map(match => match[1]).sort();
  assert.deepEqual(assigned, Object.values(notificationRoutes).filter(entry => !entry.domain).map(entry => entry.path).sort(), "every slice-10 inventory row migrated");
  for (const [name, entry] of Object.entries(notificationRoutes)) {
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), entry.hash), "pin mutation control");
    const page = read(entry.path);
    assert.ok(page.includes(entry.anyMethod ? 'handler, req.method ?? ""' : `withTaskWriteFlag(handler, "${entry.method}"`));
    assert.ok(page.includes(`(await import("@/lib/api/notification-writes/${entry.module}")).${entry.method}`));
    assert.ok(read(`src/lib/api/notification-writes/${entry.module}.ts`).includes("taskWriteRoute"));
    assert.ok(!fs.existsSync(path.join(root, entry.path.replace("src/pages/api/", "src/app/api/").replace(/\.ts$/, "/route.ts"))), "no URL twin");
  }
  console.log("notification structural verification passed; slice-10 inventory and task-seen companion pinned");
}

const notificationSettingsRoutes = {
  "access": {
    "module": "access",
    "methods": [
      "GET"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/access.ts",
    "hash": "b8532082d9cf9238eeafbd7b9b6cd0a2198554ce405cbfaed60bb3b0e9b3826d"
  },
  "changePushNotificationStatus": {
    "module": "push-status-write",
    "methods": [
      "POST"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/changePushNotificationStatus.ts",
    "hash": "e4cc04a0aee7e64cbd5469da50b7a117b956f30b52b53207655760d5fe9b447b"
  },
  "getAll": {
    "module": "all-read",
    "methods": [
      "GET"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/getAll.ts",
    "hash": "e19347613818bc0d8fd6192144d9d5a7b8e9d5314b27eb3bed599a9199ca4f25"
  },
  "getAllInbox": {
    "module": "archived-read",
    "methods": [
      "GET"
    ],
    "anyMethod": true,
    "path": "src/pages/api/notifications/getAllInbox.ts",
    "hash": "3c33e20ce6a6d661d6853a5d7b3c6f8eace1a80d16af54ce7dcce391e09e753b"
  },
  "getCount": {
    "module": "count-read",
    "methods": [
      "GET"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/getCount.ts",
    "hash": "847e3d8c1c846f7fec053e1f836d31067593727e533778330a9ad4e322c20d2b"
  },
  "getPushNotificationStatus": {
    "module": "push-status-read",
    "methods": [
      "GET"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/getPushNotificationStatus.ts",
    "hash": "a51b85aab4614ab7ba387ffa8c1e65dcd0ad9ceee8f1f110335f0e66179f5ae7"
  },
  "matrix": {
    "module": "matrix",
    "methods": [
      "GET",
      "POST"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/matrix.ts",
    "hash": "6e96da9184fa2ad3b97ad79ea407ee501fea5519596694240d8becb660be0671"
  },
  "mute": {
    "module": "mute",
    "methods": [
      "GET",
      "POST"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/mute.ts",
    "hash": "704ecadd1658873dc4d9bcfee7548abda9b3e514a6318623139a20d37f72e2aa"
  },
  "preference": {
    "module": "preference",
    "methods": [
      "POST"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/preference.ts",
    "hash": "12912e4816fbcda18ac1d640bee2327b9cfea983c444a729df822e43b0adfaf2"
  },
  "splits": {
    "module": "splits",
    "methods": [
      "GET",
      "POST"
    ],
    "anyMethod": false,
    "path": "src/pages/api/notifications/splits.ts",
    "hash": "6ebdac600b1c82f7a44d7581118e2862002828f4eaf23ec82715d306e8d88ebc"
  }
};
const notificationSettingsProtectedHashes = {
  "src/pages/api/notifications/(un)archiveBulk.ts": "5231633ec7af300889024826c3db09fd92493766828dfbaa1b7c4239e4cff948",
  "src/lib/api/notification-writes/archive-bulk.ts": "0983b8f07136fc4628d5d389370d852543d6e76265c8fc6dbe97cf8643e58735",
  "src/pages/api/notifications/getByTask.ts": "d56c67ba3ebd2f9d88cff42295a574b3748e52ad7cafb7ff917415577ea0db2d",
  "src/lib/api/notification-writes/task-seen.ts": "e8adc63197620bb1c8eb5be561672b9556e4784a15591aaff6b46b1ccb95da8e",
  "src/pages/api/notifications/markAsDone.ts": "176b0984cb340de89d2b850d1273a7f62d18582b64a89349cc9174c9cf6f5f9c",
  "src/lib/api/notification-writes/mark-done.ts": "59825e1732d9fe6bcd5f8c7919044e61c40e50efbe422d4f68cf39f122a589c1",
  "src/pages/api/notifications/markAsUnseen.ts": "4962f47ea8d22d7202c79e51057506e4055f0a3c8f27cf539c8de93a2e33645f",
  "src/lib/api/notification-writes/mark-unseen.ts": "576b981ceac1e43716eedf0e8c09bfbf0ef09289eecf4fda61e246fca4d7c338",
  "src/pages/api/notifications/moveTaskToInbox.ts": "4570f40a5a3c26c070a4e36f430e4ffe343e0b389e10f5f8900a40ecfe0a87e0",
  "src/lib/api/notification-writes/move-task-to-inbox.ts": "a94d4c241456063c05faef2a59bc0188b3a5ee5a1ef67d16155b06f6238bd9b7",
  "src/pages/api/notifications/sendEmailToFollower.ts": "70421016d06368d08d68e95a4ec42eadb4b7ebb893e8b485143cc98ac40d3d41",
  "src/lib/api/notification-writes/follower-email.ts": "b64177bb06505ec5c88c8c8f116180ec5ea9d79b1cd540fd00f0deaeb7868cff",
  "src/pages/api/notifications/unArchiveNotificationById.ts": "4d5382c27d6dbfa4eb332a51469e49c0b94f3885fb132050690d13621a415766",
  "src/lib/api/notification-writes/unarchive-by-id.ts": "1ba74c345046ca08e08e4ce6fff2764d232fc968be30d3eb53234211c4231923",
  "src/pages/api/comments/updateSeen.ts": "b195ce617cfcaafd457fb4d9ca0b5e3144bc5cd2d154e9ae60c612c351614fa6",
  "src/lib/api/notification-writes/comments-seen.ts": "26fd763a255cd97ee4e0d6376490cba903efe8c2aa2378c7d18235cd8c1ffc20",
  "src/lib/api/task-writes/route.ts": "ede51193ada9ee53a18b8d1b54ab7a6f0a7ac47f0fe98ece94293556cb0faa71",
  "src/lib/api/task-writes/read-query.ts": "0fe62c1d4921f4c389e3901e9058e4905f96ee962e0000ee528ea66febd54409",
  "src/prisma/schema.prisma": "a67938af392180ea5f40ee997db680c883a337b30911fc0d44dfebbde48ef603",
  "src/utils/controllers/notifications/IdsToSendNotificationsTo.ts": "c30396e30d121cac255f7a17d2b72d1efaeb3fef4560e76828b46849cb3ed618",
  "src/utils/controllers/notifications/projectMute.ts": "16c4dd2964146fccbc160654ee537356ab037524bbb2549ed0a07fa7e26ccd3b",
  "src/app/api/notifications/project-mute/route.ts": "b1debce26eeb1aeb76f4e0beab91c30749b6c33cc0a8dcabf25b7fe726583ee0",
  "src/lib/inboxSplitSettings.ts": "06f78aab98f08989a71c86bc821c8a3f42edc9f35249d9ec64d002b9d617adad",
  "src/utils/controllers/notifications/getAll.ts": "7e7f1ed5f1ad400d045d561722feac57f1373e33b2a553bd82a067da2a9c658c",
  "src/utils/controllers/notifications/getCount.ts": "5b342c092bf198dbe6b9b74ce3fff915a14282cc1c1fc2601278939063802c30",
  "src/utils/controllers/notifications/getAccessibleProjectIds.ts": "5efc0573e9c9fee87d651442e4bf9c32c4a3adb0536ee4d8a5f53972fdf88636" // gitleaks:allow sha256 file pin, not a secret
};
function notificationSettingsLegacySources() {
  return Object.fromEntries(Object.entries(notificationSettingsRoutes).map(([name, entry]) => {
    const fixture = JSON.parse(read(`tests/fixtures/htpr-6968-slice-11/${name}.legacy.json`));
    assert.equal(crypto.createHash("sha256").update(fixture).digest("hex"), entry.hash, name + " fixture bytes");
    let source = read(entry.path).replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "");
    if (entry.anyMethod) {
      source = source.replace('async function handler(', 'export default  async function handler(')
        .replace("import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'", "import type { NextApiRequest, NextApiResponse } from 'next'");
      source = source.slice(0, source.indexOf('\n\nexport default ((req, res)'));
    } else source = source.replace(/export default withTaskWriteFlag([\s\S]*?);(?=\n|$)/, "export default handler;");
    assert.equal(source, fixture, name + " byte-identical legacy fallback");
    return [name, fixture];
  }));
}
function notificationSettings() {
  const sources = notificationSettingsLegacySources();
  const doc = read("docs/htpr-6509-slices.md");
  const assigned = [...doc.matchAll(/^\| `(src\/pages\/api\/[^`]+)` \| 11 \|/gm)].map(match => match[1]).sort();
  assert.deepEqual(assigned, Object.values(notificationSettingsRoutes).map(entry => entry.path).sort(), "every slice-11 inventory row migrated");
  for (const [file, hash] of Object.entries(notificationSettingsProtectedHashes)) {
    assert.equal(crypto.createHash("sha256").update(read(file)).digest("hex"), hash, file + " unchanged slice-10/shared service/model bytes");
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(read(file) + "changed").digest("hex"), hash), "protected pin mutation control");
  }
  for (const [name, entry] of Object.entries(notificationSettingsRoutes)) {
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), entry.hash), "legacy pin mutation control");
    const page = read(entry.path);
    for (const method of entry.methods) {
      assert.ok(page.includes(entry.anyMethod ? 'handler, req.method ?? ""' : `"${method}", async () =>`));
      assert.ok(page.includes(`(await import("@/lib/api/notification-writes/${entry.module}")).${method}`));
    }
    assert.ok(read(`src/lib/api/notification-writes/${entry.module}.ts`).includes("taskWriteRoute"));
    assert.ok(!fs.existsSync(path.join(root, entry.path.replace("src/pages/api/", "src/app/api/").replace(/\.ts$/, "/route.ts"))), "no URL twin");
  }
  notifications();
  console.log("notification settings structural verification passed; slice-11 inventory, legacy fixtures and protected pins");
}

const deadCandidates = [
  "tasks/getAll", "tasks/linkPullRequest", "projects/detail", "projects/views/sync-view",
  "section/getAll", "section/getByTaskId", "notifications/mute",
];
const baselineDiagnostics = [
  "src/components/Modals/Sheets/AppSheet.tsx(2,17): error TS2305: Module '\"react-modal-sheet\"' has no exported member 'useScrollPosition'.",
  "src/components/Modals/Sheets/AppSheet.tsx(149,7): error TS2322: Type 'SheetDetent' is not assignable to type 'SheetDetent | undefined'.",
  "src/components/Modals/Sheets/AppSheet.tsx(173,13): error TS2322: Type '{ children: ReactNode; disableScroll: boolean; disableDrag: boolean; scrollClassName: string; }' is not assignable to type 'IntrinsicAttributes & Omit<CommonProps, \"drag\" | \"onDrag\" | \"onDragEnd\" | \"onDragStart\" | \"dragConstraints\" | \"dragElastic\" | \"dragMomentum\"> & { ...; } & RefAttributes<...>'.",
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx(39,49): error TS7006: Parameter 'member' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(210,75): error TS7006: Parameter 'section' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(212,56): error TS7006: Parameter 'task' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(219,27): error TS7006: Parameter 'taskLabel' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(220,30): error TS7006: Parameter 'label' implicitly has an 'any' type.",
  "src/hooks/MultiPages/Tasks/useTagsModal.ts(53,56): error TS7006: Parameter 'id' implicitly has an 'any' type.",
  "src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx(126,62): error TS7006: Parameter 'sec' implicitly has an 'any' type.",
  "src/lib/mcp-server/streamable-http.ts(13,31): error TS2339: Property 'http' does not exist on type 'RequestHandlerExtra<ServerRequest, ServerNotification>'.",
  "src/lib/mcp-server/streamable-http.ts(19,41): error TS2339: Property 'mcpReq' does not exist on type 'RequestHandlerExtra<ServerRequest, ServerNotification>'.",
  "src/lib/mcp-server/streamable-http.ts(28,36): error TS2353: Object literal may only specify known properties, and 'verboseLogs' does not exist in type 'ServerOptions'.",
  "src/lib/redis.ts(45,26): error TS2769: No overload matches this call.",
  "src/lib/state.tsx(8,3): error TS2305: Module '\"jotai\"' has no exported member 'useAtomValueRawSync'.",
];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
function run(command, args, name) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  fs.mkdirSync(path.join(root, ".unlazy/htpr-6923"), { recursive: true });
  fs.writeFileSync(path.join(root, `.unlazy/htpr-6923/${name}.log`), output);
  console.log(output);
  return { result, output };
}
function filesAt(directory, prefix) {
  return execFileSync("git", ["ls-files", "-z", "--", prefix], { cwd: directory, encoding: "utf8" })
    .split("\0").filter((file) => file && /\.(?:[cm]?js|tsx?|zig|py|json|sh|html|md)$/.test(file))
    .map((file) => ({ file, text: fs.readFileSync(path.join(directory, file), "utf8") }));
}
function callerFiles(endpoint, corpus) {
  const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Includes shortened URLs and source imports conservatively, but not prefix siblings.
  const pattern = new RegExp(`/${escaped}(?=[?\\#\\s'\"\x60)]|$)`);
  return corpus.filter(({ file, text }) => {
    // Extracted handlers import controllers, not the matching HTTP URL.
    if (endpoint.startsWith("section/") || endpoint === "notifications/getByTask" || endpoint === "tasks/getAll") {
      for (const quote of ['"', "'"]) text = text.replaceAll(`${quote}@/utils/controllers/${endpoint}${quote}`, "");
    }
    return file !== `src/pages/api/${endpoint}.ts` && pattern.test(text);
  });
}
function inventory() {
  const routes = git("ls-files", "src/pages/api/tasks", "src/pages/api/projects", "src/pages/api/section", "src/pages/api/notifications")
    .split("\n").filter((file) => file.endsWith(".ts"));
  const corpora = [filesAt(root, "src"), filesAt(cli, "."), filesAt(root, "e2e")];
  return routes.map((file) => {
    const endpoint = file.replace("src/pages/api/", "").replace(/\.ts$/, "");
    return { file, endpoint, callers: corpora.map((corpus) => callerFiles(endpoint, corpus).length) };
  });
}
function plan() {
  const doc = read("docs/htpr-6509-slices.md").split("## HTPR-6923: remaining Pages Router migration")[1];
  assert.ok(doc, "ticket-specific plan exists");
  const rows = [...doc.matchAll(/^\| `src\/pages\/api\/([^`]+\.ts)` \| (\d+) \| ([^|]+) \| (\d+) \/ (\d+) \/ (\d+) \|$/gm)]
    .map((match) => ({ file: `src/pages/api/${match[1]}`, slice: Number(match[2]), callers: match.slice(4, 7).map(Number) }));
  const measured = inventory();
  assert.deepEqual(rows.map(({ file }) => file).sort(), measured.map(({ file }) => file).sort(), "every route has exactly one primary slice");
  assert.ok(rows.every(({ slice }) => slice >= 1 && slice <= 12));
  for (const row of rows) assert.deepEqual(row.callers, measured.find(({ file }) => file === row.file).callers, row.file);
  for (const endpoint of deadCandidates) {
    assert.deepEqual(measured.find((row) => row.endpoint === endpoint).callers, [0, 0, 0], endpoint);
    assert.ok(doc.includes(`\`/api/${endpoint}\``), "every candidate has a disposition");
  }
  assert.equal(callerFiles("tasks/single", [{ file: "fixture.ts", text: 'fetch("/api/tasks/single?id=42")' }]).length, 1, "positive absence-check control");
  assert.throws(() => assert.equal(callerFiles("tasks/getAll", [{ file: "fixture.ts", text: 'fetch("/api/tasks/getAll")' }]).length, 0));
  assert.equal(callerFiles("tasks/create", [{ file: "fixture.ts", text: 'fetch("/api/tasks/createGlobally")' }]).length, 0, "prefix sibling is not a caller");
  console.log(`slice plan verified: ${rows.length} routes, ${new Set(rows.map(({ slice }) => slice)).size} primary groups, 7 zero-caller candidates; CLI ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: cli, encoding: "utf8" }).trim()}`);
}
async function flag() {
  const { load } = require("./task-route-loader.cjs");
  const flags = load("src/lib/flags.ts", {
    "@/lib/prisma": { default: {
      featureFlag: { findUnique: async () => null },
      user: { findUnique: async ({ where }) => ({ email: where.id === 6 ? "valentin.yeo@gmail.com" : "valentin@hypertask.ai" }) },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
    "@/lib/agentRuns/model": { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: "test" },
  });
  const key = flags.HTPR_6923_APP_ROUTER_WRITES_FLAG;
  assert.equal(key, "htpr-6923-app-router-writes");
  assert.ok(flags.FEATURE_FLAG_KEYS.includes(key));
  assert.deepEqual(await Promise.all([6, 985, 2343].map((id) => flags.isFeatureEnabled(key, id))), [true, true, false]);
  const { result } = run("npm", ["run", "test:file", "--", "tests/feature-flag-gate.test.cjs", "tests/feature-flags.test.cjs"], "flag");
  assert.equal(result.status, 0);
  console.log("flag verification passed");
}
function regression() {
  const files = [
    "tests/htpr-6923-task-writes.test.cjs", "tests/task-single-auth.test.cjs", "tests/task-move-pages-runtime.test.cjs",
    "tests/task-move-error-message.test.cjs", "tests/task-write-access-choke-points.test.cjs",
    "tests/task-write-controller-auth.test.cjs", "tests/task-write-access-gate.test.cjs",
    "tests/task-route-consolidation.test.cjs", "tests/htpr-6478-mcp-services.test.cjs", "tests/htpr-6478-permissions.test.cjs",
    "tests/ui-patterns.test.cjs",
  ];
  const { result } = run("npm", ["run", "test:file", "--", ...files], "regression");
  assert.equal(result.status, 0);
  console.log("regression verification passed");
}
function quality() {
  const lint = run("npm", ["run", "lint"], "lint");
  assert.equal(lint.result.status, 0, "full lint must pass");
  const tsc = run("npx", ["tsc", "--noEmit", "--pretty", "false"], "tsc");
  assert.equal(tsc.result.stderr, "");
  const diagnostics = tsc.output.split(/\r?\n/).filter((line) => line.includes("error TS"));
  assert.deepEqual(diagnostics, baselineDiagnostics, "exact independently captured baseline; no diagnostics added or silently removed");
  assert.ok([1, 2].includes(tsc.result.status));
  git("diff", "--check");
  console.log(`quality verification passed: full lint clean; full tsc ${diagnostics.length} baseline diagnostics, no new diagnostics (exit ${tsc.result.status})`);
}
function commit() {
  assert.equal(git("branch", "--show-current"), "htpr-6923-pages-router-writes");
  assert.match(git("log", "-1", "--format=%s"), /^HTPR-6923 /);
  assert.equal(git("log", "-1", "--format=%an <%ae>"), "Dev 1 (HT) <ht-bug-fixer@agents.hypertask.ai>");
  assert.equal(git("rev-parse", "HEAD^"), base);
  const allowed = new Set([
    "docs/htpr-6509-slices.md", "src/lib/flags.ts", "src/lib/api/task-writes/route.ts", "src/lib/api/task-writes/update.ts",
    "src/lib/api/task-writes/move.ts", "src/pages/api/tasks/single.ts", "src/pages/api/tasks/moveTask.ts",
    "tests/task-single-auth.test.cjs", "tests/feature-flags.test.cjs", "tests/htpr-6923-task-writes.test.cjs", "tests/htpr-6923-verify.cjs",
  ]);
  const changed = git("diff", "--name-only", base, "HEAD").split("\n");
  assert.deepEqual(changed.sort(), [...allowed].sort(), "no sibling scope or unrelated changes");
  const numstat = git("diff", "--numstat", base, "HEAD").split("\n");
  const productionLines = numstat.filter((line) => !line.split("\t")[2].startsWith("tests/"))
    .reduce((sum, line) => sum + Number(line.split("\t")[0]) + Number(line.split("\t")[1]), 0);
  assert.ok(productionLines < 800, `production/doc changed lines ${productionLines}`);
  assert.equal(git("diff", "--name-only"), "", "no tracked changes after commit");
  assert.equal(git("diff", "--cached", "--name-only"), "");
  assert.deepEqual(git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean), ["GATES.md"], "only the local proof ledger is untracked");
  for (const [kind, file] of Object.entries({ update: "src/pages/api/tasks/single.ts", move: "src/pages/api/tasks/moveTask.ts" })) {
    const source = read(file).replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
      .replace(/export default withTaskWriteFlag\([\s\S]*$/, "export default handler;\n");
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), legacyHashes[kind]);
  }
  assert.throws(() => assert.ok(allowed.has("src/lib/mcp/auth.ts")), "scope control rejects a sibling file");
  console.log(`local commit verified: ${git("rev-parse", "HEAD")}; ${productionLines} production/doc changed lines; only GATES.md is local`);
}
module.exports = { slice5c, slice5cLegacySource, notificationSettingsRoutes, notificationSettingsLegacySources, notificationSettings, notificationRoutes, notificationLegacySources, notifications, sectionRoutes, sectionLegacySources, projectViewRoutes, projectViewLegacySources, projectCoreRoutes, projectCoreLegacySources, slice5bRoutes, slice5bLegacySources, slice5Routes, slice5LegacySources, attachmentRoutes, attachmentLegacySources, legacyHashes, lifecycleHashes, lifecycleLegacySources, slice3Routes, slice3LegacySources, inventory, callerFiles };
if (require.main === module) {
  const commands = { notifications, sections, "project-views": projectViews, "project-core": projectCore, attachments, plan, flag, regression, quality, commit, lifecycle, slice3, slice5, slice5b, slice5c };
  assert.ok(commands[process.argv[2]], "known verification mode required");
  Promise.resolve(commands[process.argv[2]]()).catch((error) => { console.error(error); process.exitCode = 1; });
}
