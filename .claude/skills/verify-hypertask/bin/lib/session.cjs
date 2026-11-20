const { createRequire } = require("node:module");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { fail, readJson, repoRoot, runDir } = require("./context.cjs");

function sessionFile() {
  return path.join(runDir(), "session", "session.json");
}

function readSession() {
  return readJson(sessionFile(), null);
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requireSession() {
  const session = readSession();
  if (!session?.port || !alive(session.pid)) {
    fail("no live browser session", "Run ht-verify session start, then retry this command.", "not-ready");
  }
  return session;
}

function playwright() {
  return createRequire(path.join(repoRoot, "package.json"))("playwright");
}

async function connect() {
  const session = requireSession();
  const browser = await playwright().chromium.connectOverCDP(`http://127.0.0.1:${session.port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());
  return { browser, session, page };
}

async function withPage(action) {
  const { browser, session, page } = await connect();
  try {
    return await action(page, session);
  } finally {
    await browser.close();
  }
}

function sessionState() {
  if (process.env.HT_VERIFY_STATE) return process.env.HT_VERIFY_STATE;
  const seeded = path.join(runDir(), "browser", "state.json");
  return existsSync(seeded) ? seeded : null;
}

module.exports = { alive, connect, playwright, readSession, requireSession, sessionFile, sessionState, withPage };
