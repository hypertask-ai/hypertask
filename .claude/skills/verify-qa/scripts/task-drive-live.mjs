import path from "node:path";
import { driveMain } from "./drive-cli.mjs";

await driveMain("task", process.argv.slice(2), { title: "title visible" }, async ({ base, dir, context, page, board, task, projectId, breakStep, step }) => {
  if (breakStep) await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "#title-input { display: none !important }";
      document.head.append(style);
    });
  });
  const marker = `qadrive${Date.now()}`;
  await page.goto(`/detail/project-${projectId}/${task.uniqueIndex}?realtime=on`, { waitUntil: "domcontentloaded" });
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
});
