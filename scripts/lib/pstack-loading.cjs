const LOADING_SELECTOR = '[aria-busy="true"], [role="progressbar"], [data-testid="full-screen-chat-loading"], [data-testid="loading-spinner"], [data-loading="true"]';
const LOADING_LABELS = ["Loading AI chat", "Writing your ticket"];
const LOADING_TIMEOUT_MS = 8000;
const LOADING_POLL_MS = 200;
const LOADING_NOTE = "page still loading";

const READ = `(() => {
  const hit = document.querySelector(${JSON.stringify(LOADING_SELECTOR)});
  if (hit) {
    const named = String(hit.getAttribute("data-testid") || hit.getAttribute("aria-label") || hit.getAttribute("role") || "");
    return named || "loading";
  }
  const labels = ${JSON.stringify(LOADING_LABELS)};
  const status = [...document.querySelectorAll('[role="status"]')].find((node) => labels.some((label) => String(node.textContent || "").includes(label)));
  if (!status) return "";
  const text = String(status.textContent || "");
  return labels.find((label) => text.includes(label)) || "loading";
})()`;

async function loadingLabel(page) {
  try { return String((await page.evaluate(READ)) ?? ""); } catch { return ""; }
}

async function waitForLoadingGone(page, {
  timeoutMs = LOADING_TIMEOUT_MS,
  pollMs = LOADING_POLL_MS,
  sleep = (ms) => new Promise((done) => { setTimeout(done, ms); }),
  read = loadingLabel,
} = {}) {
  const started = Date.now();
  for (;;) {
    const label = await read(page);
    if (!label) return { settled: true, label: "", waitedMs: Date.now() - started };
    if (Date.now() - started >= timeoutMs) return { settled: false, label, waitedMs: Date.now() - started };
    await sleep(pollMs);
  }
}

function stillLoadingNote(state) {
  return state?.settled === false ? `${LOADING_NOTE}: ${state.label || "loading"}` : "";
}

module.exports = {
  LOADING_LABELS,
  LOADING_READ: READ,
  LOADING_NOTE,
  LOADING_POLL_MS,
  LOADING_SELECTOR,
  LOADING_TIMEOUT_MS,
  loadingLabel,
  stillLoadingNote,
  waitForLoadingGone,
};
