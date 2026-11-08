#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE = "https://app.hypertask.ai";
const INBOX_SECRET = process.env.CRON_SECRET || "";
const REPORT_TOKEN = process.env.HYPERTASK_MCP_TOKEN || "";
const PARENT_TICKET = process.env.FUNNEL_PROBE_PARENT_TICKET || "MARK-164";
const steps = [];

function record(step, ok, detail) {
  steps.push({ step, ok, detail: String(detail).slice(0, 240) });
}

function dailyEmail() {
  const day = new Date().toISOString().slice(0, 10);
  const suffix = createHash("sha256").update(randomUUID()).digest("hex").slice(0, 10);
  return `daily-${day}-${suffix}@funnel-probe.hypertask.app`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollInbox(email) {
  for (let i = 0; i < 12; i++) {
    const response = await fetch(`${BASE}/api/ops/funnel-probe-inbox?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${INBOX_SECRET}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 404) { await wait(5_000); continue; }
    const data = await response.json().catch(() => ({}));
    if (data?.found && data.entry?.verificationUrl) return data.entry.verificationUrl;
    await wait(5_000);
  }
  return null;
}

async function postReport(passed) {
  if (!REPORT_TOKEN) return true;
  const lines = steps.map((s) => `<li><p>${s.ok ? "PASS" : "FAIL"}: ${s.step} — ${s.detail}</p></li>`).join("");
  const body = `<p><strong>${passed ? "PASS" : "FAIL"}: daily funnel probe signup</strong></p><ul>${lines}</ul>`;
  try {
    const response = await fetch(`${BASE}/api/mcp/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REPORT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_number: PARENT_TICKET, project_id: 2108, text: body, content_type: "html" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) { record("mark-164 report", false, `HTTP ${response.status}`); return false; }
    record("mark-164 report", true, "posted");
    return true;
  } catch (error) {
    record("mark-164 report", false, error?.message || String(error));
    return false;
  }
}

async function finish(passed) {
  const reported = await postReport(passed);
  if (!passed || (REPORT_TOKEN && !reported)) process.exitCode = 1;
}

async function main() {
  if (!INBOX_SECRET) throw new Error("CRON_SECRET is required");
  const email = dailyEmail();
  record("new probe identity", true, email.split("@")[0]);
  const signup = await fetch(`${BASE}/api/auth/instant-signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, utmData: { utm_source: "funnel_probe_daily" } }),
    signal: AbortSignal.timeout(60_000),
  });
  const signupBody = await signup.json().catch(() => ({}));
  record("instant signup", signup.ok && signupBody.success !== false, signupBody.error || signup.status);
  const verifyUrl = await pollInbox(email);
  record("verification inbox", Boolean(verifyUrl), verifyUrl ? "link ready" : "no link after polling");
  if (!verifyUrl) return finish(false);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let verified = false;
  try {
    await page.goto(verifyUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByText("successfully verified", { exact: false }).waitFor({ timeout: 120_000 });
    verified = true;
  } catch { verified = false; }
  finally { await browser.close(); }
  record("email verify navigation", verified, page.url());
  return finish(steps.every((s) => s.ok));
}

main().catch(async (error) => {
  record("runner", false, error.message || error);
  await finish(false);
});
