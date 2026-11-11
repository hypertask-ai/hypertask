import path from "node:path";
import { driveMain } from "./drive-cli.mjs";

function commentId(body, marker) {
  const comments = Array.isArray(body?.comments) ? body.comments : [];
  return comments.find((comment) => JSON.stringify(comment).includes(marker))?.id ?? null;
}

await driveMain("comments", process.argv.slice(2), { post: "comment appears" }, async ({ base, dir, context, page, board, task, projectId, breakStep, step }) => {
  if (breakStep) await page.route("**/api/comments/create", (route) => route.abort());
  const marker = `qacomment${Date.now()}`;
  await page.goto(`/detail/project-${projectId}/${task.uniqueIndex}?realtime=on`, { waitUntil: "domcontentloaded" });
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
  const outside = async () => {
    await page.waitForFunction(marker => [...document.querySelectorAll("body *")].some(el => !el.children.length && !el.closest("#comment-input") && el.textContent?.includes(marker)), marker, { timeout: 10_000 }).catch(() => {});
    return page.locator(`text=${marker}`).evaluateAll((els) => els.filter((el) => !el.closest("#comment-input")).length);
  };
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
});
