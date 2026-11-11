#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driveMain } from "./drive-cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BREAKS = { post: "comment appears" };

async function boardPath(explicit) {
  if (explicit) return explicit;
  const fixture = JSON.parse(await fs.readFile(path.join(root, "e2e/smoke/.state/card-fixture.json"), "utf8").catch(() => "{}"));
  if (fixture.boardPath) return fixture.boardPath;
  const id = /^\/detail\/project-(\d+)\//.exec(fixture.detailPath || "")?.[1];
  return id ? `/project?id=${id}` : "";
}

function projectId(board) {
  return Number(/[?&]id=(\d+)/.exec(board)?.[1] || /^\/detail\/project-(\d+)/.exec(board)?.[1]);
}

function commentId(body, marker) {
  const comments = Array.isArray(body?.comments) ? body.comments : [];
  return comments.find((comment) => JSON.stringify(comment).includes(marker))?.id ?? null;
}

async function run({ base, state, dir, board, breakStep, step }) {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
  const destination = await boardPath(board);
  if (!destination) throw new Error("comments drive needs --board <board path> or the browser-smoke card fixture");
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: base, storageState: state, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const created = [];
  if (breakStep === "post") {
    await page.route("**/api/comments/create", (route) => route.abort());
  }
  try {
    const me = await (await context.request.post("/api/app-shell/bootstrap")).json();
    const userId = me.slices?.user?.data?.id;
    const id = projectId(destination);
    if (!userId || !id) throw new Error("comments drive could not read the seeded user or board");
    const boardBody = await (await context.request.post("/api/projects/boardTasks", { data: { projectId: id } })).json();
    const sectionId = boardBody?.project?.section?.[0]?.id;
    if (!sectionId) throw new Error("seeded board has no column");
    const marker = `qacomment${Date.now()}`;
    const createdBody = await (await context.request.post("/api/tasks/create", {
      data: { title: `[qa-runner] comment drive ${marker}`, projectId: id, sectionId, userId, fullScreenTask: true },
    })).json();
    const task = createdBody?.newTask?.newTask ?? createdBody?.newTask ?? createdBody?.task ?? createdBody;
    if (!task?.id || !task?.uniqueIndex) throw new Error("task create returned no id");
    created.push(task.id);
    await page.goto(`/detail/project-${id}/${task.uniqueIndex}?realtime=on`, { waitUntil: "domcontentloaded" });
    await page.locator("#title-input").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#comment-input").click();
    const editor = page.locator("#comment-input .ProseMirror[contenteditable='true']");
    await editor.waitFor({ state: "visible", timeout: 5_000 });
    await editor.click();
    await page.keyboard.type(`QA drive comment ${marker}`);
    const saved = page.waitForResponse(
      (response) => response.url().includes("/api/comments/create") && response.request().method() === "POST",
      { timeout: 15_000 },
    ).catch(() => null);
    await page.keyboard.press("Control+Enter");
    const response = await saved;
    const outside = async () => page.locator(`text=${marker}`).evaluateAll((els) => els.filter((el) => !el.closest("#comment-input")).length);
    const posted = Boolean(response?.ok()) && (await outside()) > 0;
    await page.screenshot({ path: path.join(dir, "01-comment.png") });
    step("comment appears", posted, { status: response?.status() ?? 0 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#title-input").waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    const persisted = (await outside()) > 0;
    await page.screenshot({ path: path.join(dir, "02-comment-reload.png") });
    step("comment survives reload", persisted, {});
    let deleted = false;
    const listed = await (await context.request.get(`/api/comments/getByTask?taskId=${task.id}`)).json();
    const found = commentId(listed, marker);
    if (found) {
      const removal = await context.request.post("/api/comments/deleteCommentById", { data: { id: found } });
      const after = await (await context.request.get(`/api/comments/getByTask?taskId=${task.id}`)).json();
      deleted = removal.ok() && commentId(after, marker) === null;
    }
    step("comment deleted by the script", deleted, { found });
  } finally {
    for (const taskId of created) {
      await context.request.post("/api/queues/tasks/taskDeleteReminder", { data: { taskId } }).catch(() => {});
      await context.request.delete(`/api/tasks/deleteTask?taskId=${taskId}`).catch(() => {});
    }
    await browser.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await driveMain("comments", "comments drive", process.argv.slice(2), BREAKS, run);
