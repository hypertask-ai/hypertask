#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driveMain } from "./drive-cli.mjs";
import { THEMES, themeLanded } from "./drive-grade.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BREAKS = { columns: "columns visible" };

async function boardPath(explicit) {
  if (explicit) return explicit;
  const fixture = JSON.parse(await fs.readFile(path.join(root, "e2e/smoke/.state/card-fixture.json"), "utf8").catch(() => "{}"));
  if (fixture.boardPath) return fixture.boardPath;
  const id = /^\/detail\/project-(\d+)\//.exec(fixture.detailPath || "")?.[1];
  return id ? `/project?id=${id}&surface=board` : "";
}

function projectId(board) {
  return Number(/[?&]id=(\d+)/.exec(board)?.[1] || /^\/detail\/project-(\d+)/.exec(board)?.[1]);
}

async function dragCard(page, taskId, openBoard) {
  const handle = `[data-rfd-drag-handle-draggable-id="task-${taskId}"]`;
  const card = page.locator(handle);
  await card.waitFor({ state: "visible", timeout: 10_000 });
  const columns = page.locator("[data-rfd-droppable-id]");
  const count = await columns.count();
  let targetId = "";
  for (let index = 0; index < count; index += 1) {
    const column = columns.nth(index);
    if ((await column.locator(handle).count()) === 0) {
      targetId = await column.getAttribute("data-rfd-droppable-id");
      break;
    }
  }
  if (!targetId) return false;
  const target = page.locator(`[data-rfd-droppable-id="${targetId}"]`);
  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) return false;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      cardBox.x + ((targetBox.x - cardBox.x) * step) / 8,
      cardBox.y + ((targetBox.y - cardBox.y) * step) / 8,
    );
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
  await openBoard();
  return (await page.locator(`[data-rfd-droppable-id="${targetId}"]`).locator(handle).count()) > 0;
}

async function run({ base, state, dir, board, breakStep, step }) {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
  const destination = await boardPath(board);
  if (!destination) throw new Error("board drive needs --board <board path> or the browser-smoke card fixture");
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: base, storageState: state, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const created = [];
  const openBoard = async () => {
    await page.goto(`${destination}${destination.includes("?") ? "&" : "?"}realtime=on`, { waitUntil: "domcontentloaded" });
  };
  if (breakStep === "columns") {
    await page.addInitScript(() => {
      const hide = () => document.querySelectorAll(".kanban-column-title").forEach((node) => node.remove());
      new MutationObserver(hide).observe(document.documentElement, { childList: true, subtree: true });
      hide();
    });
  }
  try {
    const me = await (await context.request.post("/api/app-shell/bootstrap")).json();
    const userId = me.slices?.user?.data?.id;
    const id = projectId(destination);
    if (!userId || !id) throw new Error("board drive could not read the seeded user or board");
    const boardBody = await (await context.request.post("/api/projects/boardTasks", { data: { projectId: id } })).json();
    const sectionId = boardBody?.project?.section?.[0]?.id;
    if (!sectionId) throw new Error("seeded board has no column");
    const createdBody = await (await context.request.post("/api/tasks/create", {
      data: { title: `[qa-runner] board drive ${Date.now()}`, projectId: id, sectionId, userId, fullScreenTask: true },
    })).json();
    const task = createdBody?.newTask?.newTask ?? createdBody?.newTask ?? createdBody?.task ?? createdBody;
    if (!task?.id) throw new Error("task create returned no id");
    created.push(task.id);
    await openBoard();
    if (breakStep !== "columns") {
      await page.locator(".kanban-column-title").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    }
    const columnCount = await page.locator(".kanban-column-title").count();
    await page.screenshot({ path: path.join(dir, "01-board.png") });
    step("columns visible", columnCount >= 2, { columnCount });
    const cardVisible = (await page.locator(`[data-rfd-drag-handle-draggable-id="task-${task.id}"]`).count()) > 0;
    step("card visible", cardVisible, { taskId: task.id });
    const stayed = cardVisible && columnCount >= 2 ? await dragCard(page, task.id, openBoard) : false;
    await page.screenshot({ path: path.join(dir, "02-after-drag.png") });
    step("drag survives reload", stayed, {});
    for (const theme of THEMES) {
      await context.addCookies([{ name: "theme", value: theme, url: base }]);
      await openBoard();
      const actual = await page.locator("html").getAttribute("data-theme");
      const columns = (await page.locator(".kanban-column-title").count()) >= 1;
      const card = (await page.locator(`[data-rfd-drag-handle-draggable-id="task-${task.id}"]`).count()) >= 1;
      await page.screenshot({ path: path.join(dir, `theme-${theme}.png`) });
      step(`${theme} keeps the board`, columns && card && themeLanded(theme, actual), { actual });
    }
  } finally {
    for (const taskId of created) {
      await context.request.post("/api/queues/tasks/taskDeleteReminder", { data: { taskId } }).catch(() => {});
      await context.request.delete(`/api/tasks/deleteTask?taskId=${taskId}`).catch(() => {});
    }
    await browser.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await driveMain("board", "board drive", process.argv.slice(2), BREAKS, run);
