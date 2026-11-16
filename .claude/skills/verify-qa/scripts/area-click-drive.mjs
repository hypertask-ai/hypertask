import path from "node:path"
import { driveMain } from "./drive-cli.mjs"
import { planForPage, screenReady } from "./area-clicks.mjs"

const pageAt = process.argv.indexOf("--page")
const plan = planForPage(pageAt === -1 ? "" : process.argv[pageAt + 1])
if (!plan || plan.kind !== "screen" || plan.script || !plan.path) {
  console.error("area click needs --page for a screen that opens in the browser")
  process.exit(2)
}

await driveMain(plan.page.replace(/\.md$/, ""), process.argv.slice(2), { ready: "screen ready" }, async ({ dir, page, projectId, task, breakStep, step }) => {
  const target = plan.path.replaceAll("{projectId}", String(projectId || "")).replaceAll("{uniqueIndex}", String(task?.uniqueIndex || ""))
  await page.goto(`${target}${target.includes("?") ? "&" : "?"}realtime=on`, { waitUntil: "domcontentloaded" })
  if (plan.how === "title" && breakStep !== "ready") {
    await page.waitForFunction((ready) => document.title.includes(ready), plan.ready, { timeout: 15_000 }).catch(() => {})
  }
  if (breakStep === "ready") {
    await page.evaluate((ready, how) => {
      document.title = "broken"
      if (how === "selector") {
        const node = document.querySelector(ready)
        if (node) node.remove()
      }
      if (how === "text" && document.body) document.body.textContent = "broken"
    }, plan.ready, plan.how)
  }
  const title = await page.title()
  const text = plan.how === "text" ? await page.locator("body").innerText().catch(() => "") : ""
  const control = plan.how === "selector" && breakStep !== "ready" ? page.locator(plan.ready).first() : null
  const selector = control ? await control.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false) : false
  if (selector) await control.click()
  await page.screenshot({ path: path.join(dir, "01-screen.png") })
  const url = page.url()
  step("screen ready", screenReady({ url, title, text, selector }, { ...plan, path: target }), { url, title })
})
