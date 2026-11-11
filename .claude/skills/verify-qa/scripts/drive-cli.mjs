import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { finish, readArgs, requireLoopback } from "./drive-grade.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export async function driveMain(area, argv, breaks, run) {
  const args = readArgs(argv);
  const base = args.base || process.env.VERIFY_QA_BASE || "";
  const state = args.state || process.env.VERIFY_QA_STATE_FILE || "";
  if (!requireLoopback(base, area)) process.exit(2);
  if (!state || (args.breakStep && !breaks[args.breakStep])) {
    console.error("Drive needs --state and a known --break name");
    process.exit(2);
  }
  const dir = args.dir || path.join(os.tmpdir(), `${area}-drive-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const steps = [];
  const step = (name, pass, detail = {}) => {
    steps.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}: ${name} ${JSON.stringify(detail)}`);
  };
  const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
  const browser = await chromium.launch();
  let task;
  try {
    const context = await browser.newContext({ baseURL: base, storageState: state, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const fixture = JSON.parse(await fs.readFile(path.join(root, "e2e/smoke/.state/card-fixture.json"), "utf8").catch(() => "{}"));
    const board = args.board || fixture.boardPath || `/project?id=${/^\/detail\/project-(\d+)\//.exec(fixture.detailPath || "")?.[1]}&surface=board`;
    const projectId = Number(/[?&]id=(\d+)/.exec(board)?.[1]);
    if (area !== "flags") {
      const me = await (await context.request.post("/api/app-shell/bootstrap")).json();
      const body = await (await context.request.post("/api/projects/boardTasks", { data: { projectId } })).json();
      const sectionId = body.project?.section?.[0]?.id;
      const userId = me.slices?.user?.data?.id;
      if (!projectId || !sectionId || !userId) throw new Error("Missing seeded board, column or user");
      const response = await context.request.post("/api/tasks/create", {
        data: { title: `[qa-runner] ${area} drive ${Date.now()}`, projectId, sectionId, userId, fullScreenTask: true },
      });
      const created = await response.json();
      task = created.newTask?.newTask ?? created.newTask ?? created.task ?? created;
      if (!response.ok() || !task.id || !task.uniqueIndex) throw new Error("Could not create drive fixture");
    }
    await run({ ...args, base, dir, context, page, board, task, projectId, step });
  } catch (error) {
    step("run", false, error.message.split("\n")[0]);
  } finally {
    await browser.close();
    if (task?.id) {
      const cleanupState = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "drive-cleanup-")), "state.json");
      const storage = JSON.parse(await fs.readFile(state, "utf8"));
      storage.cookies = storage.cookies.filter(cookie => ["127.0.0.1", "localhost"].includes(cookie.domain)).map(cookie => ({ ...cookie, domain: "app.hypertask.ai" }));
      await fs.writeFile(cleanupState, JSON.stringify(storage), { mode: 0o600 });
      const cleanup = spawnSync(process.execPath, [path.join(root, ".claude/skills/verify-qa/scripts/fixture-cleanup"), cleanupState, String(task.id), "--base-url", base.replace("localhost", "127.0.0.1")], { encoding: "utf8", timeout: 30_000 });
      await fs.rm(path.dirname(cleanupState), { recursive: true });
      step("fixture cleaned", cleanup.status === 0, { output: cleanup.stdout, error: cleanup.stderr });
    }
  }
  await fs.writeFile(path.join(dir, "result.json"), JSON.stringify({ area, steps }, null, 2));
  process.exitCode = finish(area, steps, args.breakStep, breaks[args.breakStep]);
}
