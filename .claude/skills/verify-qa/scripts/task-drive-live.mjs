#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driveMain } from "./drive-cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BREAKS = { title: "title visible" };

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

async function run({ base, state, dir, board, breakStep, step }) {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
  const destination = await boardPath(board);
  if (!destination) throw new Error("task drive needs --board <board path> or the browser-smoke card fixture");
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: base, storageState: state, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const created = [];
  if (breakStep === "title") {
    await page.addInitScript(() => {
      const hide = () => document.querySelectorAll("#title-input").forEach((node) => node.remove());
      new MutationObserver(hide).observe(document.documentElement, { childList: true, subtree: true });
      hide();
    });
  }
  try {
    const me = await (await context.request.post("/api/app-shell/bootstrap")).json();
    const userId = me.slices?.user?.data?.id;
    const id = projectId(destination);
    if (!userId || !id) throw new Error("task drive could not read the seeded user or board");
    const boardBody = await (await context.request.post("/api/projects/boardTasks", { data: { projectId: id } })).json();
    const sectionId = boardBody?.project?.section?.[0]?.id;
    if (!sectionId) throw new Error("seeded board has no column");
    const marker = `qadrive${Date.now()}`;
    const createdBody = await (await context.request.post("/api/tasks/create", {
      data: { title: `[qa-runner] task drive ${marker}`, projectId: id, sectionId, userId, fullScreenTask: true },
    })).json();
    const task = createdBody?.newTask?.newTask ?? createdBody?.newTask ?? createdBody?.task ?? createdBody;
    if (!task?.id || !task?.uniqueIndex) throw new Error("task create returned no id");
    created.push(task.id);
    await page.goto(`/detail/project-${id}/${task.uniqueIndex}?realtime=on`, { waitUntil: "domcontentloaded" });
    const titleVisible = await page.locator("#title-input").waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
    await page.screenshot({ path: path.join(dir, "01-task.png") });
    step("title visible", titleVisible, {});
    let descriptionPersisted = false;
    let boldPersisted = false;
    if (titleVisible) {
      await page.locator("#description-container").dblclick();
      const editor = page.locator("#description-input .ProseMirror[contenteditable='true']");
      await editor.waitFor({ state: "visible", timeout: 5_000 });
      await editor.click();
      await page.keyboard.type(`QA drive description ${marker} `);
      await page.keyboard.press("Control+b");
      await page.keyboard.type("bold-part");
      await page.keyboard.press("Control+b");
      await page.keyboard.press("Escape");
      await page.reload({ waitUntil: "domcontentloaded" });
      const saved = page.locator("#description-input .ProseMirror[contenteditable='false']");
      descriptionPersisted = await saved.getByText(marker).waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
      boldPersisted = descriptionPersisted && await saved.locator("strong", { hasText: "bold-part" }).waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
    }
    await page.screenshot({ path: path.join(dir, "02-description.png") });
    step("description survives reload", descriptionPersisted, { marker });
    step("bold survives reload", boldPersisted, {});
  } finally {
    for (const taskId of created) {
      await context.request.post("/api/queues/tasks/taskDeleteReminder", { data: { taskId } }).catch(() => {});
      await context.request.delete(`/api/tasks/deleteTask?taskId=${taskId}`).catch(() => {});
    }
    await browser.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await driveMain("task", "task drive", process.argv.slice(2), BREAKS, run);
