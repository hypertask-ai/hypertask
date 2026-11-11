import path from "node:path";
import { driveMain } from "./drive-cli.mjs";
import { THEMES, themeLanded } from "./drive-grade.mjs";

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
  const moved = page.waitForResponse(
    (response) => response.url().includes("/api/tasks/moveTask") && response.request().method() === "PUT",
    { timeout: 15_000 },
  ).catch(() => null);
  await page.mouse.up();
  if (!(await moved)?.ok()) return false;
  await openBoard();
  return page.locator(`[data-rfd-droppable-id="${targetId}"]`).locator(handle).waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
}

await driveMain("board", process.argv.slice(2), { columns: "columns visible" }, async ({ base, dir, context, page, board, task, projectId, breakStep, step }) => {
  const openBoard = () => page.goto(`${board}${board.includes("?") ? "&" : "?"}realtime=on`, { waitUntil: "domcontentloaded" });
  if (breakStep) await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".kanban-column-title { display: none !important }";
      document.head.append(style);
    });
  });
  await openBoard();
  if (breakStep !== "columns") {
    await page.locator(".kanban-column-title").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  }
  await page.locator(`[data-rfd-drag-handle-draggable-id="task-${task.id}"]`).waitFor({ state: "visible", timeout: 30_000 });
  const columnCount = await page.locator(".kanban-column-title:visible").count();
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
    await page.locator(`[data-rfd-drag-handle-draggable-id="task-${task.id}"]`).waitFor({ state: "visible", timeout: 30_000 });
    const actual = await page.locator("html").getAttribute("data-theme");
    const columns = (await page.locator(".kanban-column-title:visible").count()) >= 1;
    const card = (await page.locator(`[data-rfd-drag-handle-draggable-id="task-${task.id}"]`).count()) >= 1;
    await page.screenshot({ path: path.join(dir, `theme-${theme}.png`) });
    step(`${theme} keeps the board`, columns && card && themeLanded(theme, actual), { actual });
  }
});
