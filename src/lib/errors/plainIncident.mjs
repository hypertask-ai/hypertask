
const PAGE_RULES = [
  [/^\/(onboarding|interactive-onboarding)(\/|$)/, "onboarding"],
  [/^\/api\/mcp(\/|$)/, "the agent and CLI API"],
  [/^\/api(\/|$)/, "the app's background API"],
  [/^\/detail(\/|$)/, "a ticket page"],
  [/^\/(login|sign-?in)(\/|$)/, "the login page"],
  [/^\/(signup|sign-?up|register)(\/|$)/, "the signup page"],
  [/^\/settings(\/|$)/, "the settings page"],
  [/^\/inbox(\/|$)/, "the inbox"],
  [/^\/(my-tasks|mytasks)(\/|$)/, "My Tasks"],
  [/^\/(agents?|chat)(\/|$)/, "the agents and chat area"],
  [/^\/pages?(\/|$)/, "a page in the pages area"],
  [/^\/(project|projects|board|boards)(\/|-|$)/, "a board"],
  [/^\/admin(\/|$)/, "the admin area"],
];

export function plainPageName(urlOrPath) {
  if (typeof urlOrPath !== "string" || !urlOrPath.trim()) return "the app";
  let path = urlOrPath.trim();
  try {
    path = new URL(path, "https://app.invalid").pathname;
  } catch {
  }
  for (const [pattern, name] of PAGE_RULES) {
    if (pattern.test(path)) return name;
  }
  return "the app";
}

export function plainProblem(message) {
  const text = typeof message === "string" ? message : "";
  const prisma = /prisma\.(\w+)\.(\w+)\(\)`?\s+invocation/i.exec(text);
  if (prisma) {
    const model = prisma[1].replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const op = prisma[2].toLowerCase();
    if (/^(create|upsert)/.test(op)) return `saving a ${model} failed`;
    if (/^update/.test(op)) return `updating a ${model} failed`;
    if (/^delete/.test(op)) return `deleting a ${model} failed`;
    return `looking up a ${model} failed`;
  }
  if (/timed? ?out|ETIMEDOUT/i.test(text)) return "a request took too long";
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(text)) {
    return "the server could not reach another service";
  }
  if (/unauthori[sz]ed|\b401\b/i.test(text)) return "a request was refused as not signed in";
  if (/forbidden|\b403\b/i.test(text)) return "a request was refused for missing access";
  return "an unexpected error";
}

function isBrowserSource(source) {
  return source === "client" || source === "browser";
}

export function plainTitle({ kind = "error", url, message, source }) {
  const page = plainPageName(url);
  const noun = isBrowserSource(source) ? "Browser error" : "Server error";
  const lead = kind === "spike" ? `${noun} spike` : noun;
  const where = page === "the app" ? "" : ` on ${page}`;
  return `${lead}${where}: ${plainProblem(message)}`.slice(0, 99);
}

export function plainSummary({ url, message, source }) {
  const where = isBrowserSource(source) ? "in the browser" : "on the server";
  return (
    `Something failed ${where} while someone was using ${plainPageName(url)} ` +
    `(${plainProblem(message)}); they may have seen an error or a part of the page that did not load.`
  );
}
