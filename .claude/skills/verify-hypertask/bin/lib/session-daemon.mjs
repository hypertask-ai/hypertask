import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const options = JSON.parse(process.argv[2]);
const { chromium } = createRequire(path.join(options.repo, "package.json"))("playwright");
const log = (line) => appendFileSync(options.log, `${new Date().toISOString()} ${line}\n`);

const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${options.port}`] });
const context = await browser.newContext({
  baseURL: options.base,
  storageState: options.state || undefined,
  viewport: options.viewport,
});
const page = await context.newPage();
page.on("console", (message) => log(`${message.type()} ${message.text().slice(0, 500)}`));
page.on("pageerror", (error) => log(`pageerror ${error.message.slice(0, 500)}`));
page.on("requestfailed", (request) => log(`requestfailed ${request.url().slice(0, 200)} ${request.failure()?.errorText}`));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    await browser.close().catch(() => {});
    process.exit(0);
  });
}

log(`session ready on port ${options.port} for ${options.base}`);
await new Promise(() => {});
