#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE = "https://app.hypertask.ai";
const CRON_SECRET = process.env.FUNNEL_PROBE_CRON_SECRET || process.env.CRON_SECRET || "";
const REPORT_TOKEN = process.env.HYPERTASK_MCP_TOKEN || "";
const PARENT_TICKET = process.env.FUNNEL_PROBE_PARENT_TICKET || "MARK-164";
const MARK_PROJECT_ID = 2108;

const steps = [];

function record(step, ok, detail) {
  steps.push({ step, ok, detail: String(detail).slice(0, 240) });
}

function dailyEmail() {
  const day = new Date().toISOString().slice(0, 10);
  const suffix = createHash("sha256").update(randomUUID()).digest("hex").slice(0, 10);
  return `daily-${day}-${suffix}@funnel-probe.hypertask.app`;
}

async function pollInbox(email, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    const response = await fetch(
      `${BASE}/api/ops/funnel-probe-inbox?email=${encodeURIComponent(email)}`,
      {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (response.status === 404) {
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }
    const data = await response.json();
    if (data?.found && data.entry?.verificationUrl) return data.entry.verificationUrl;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return null;
}

async function postReport(passed) {
  if (!REPORT_TOKEN) return;
  const lines = steps.map((s) => `<li><p>${s.ok ? "PASS" : "FAIL"}: ${s.step} — ${s.detail}</p></li>`).join("");
  const body = `<p><strong>${passed ? "PASS" : "FAIL"}: daily funnel probe signup</strong></p><ul>${lines}</ul>`;
  await fetch(`${BASE}/api/mcp/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPORT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ticket_number: PARENT_TICKET,
      project_id: MARK_PROJECT_ID,
      text: body,
      content_type: "html",
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {});
}

async function main() {
  if (!CRON_SECRET) throw new Error("FUNNEL_PROBE_CRON_SECRET or CRON_SECRET is required");

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

  if (!verifyUrl) {
    await postReport(false);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(verifyUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(3000);
    const url = page.url();
    record("email verify navigation", !url.includes("/login"), url);
  } finally {
    await browser.close();
  }

  const passed = steps.every((s) => s.ok);
  await postReport(passed);
  if (!passed) process.exitCode = 1;
}

main().catch(async (error) => {
  record("runner", false, error.message || error);
  await postReport(false);
  process.exitCode = 1;
});
