import { readFile } from "node:fs/promises";
import path from "node:path";

const modes = ["OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"];

// live is the plain QA user's view (true means Everyone). qa is the QA account's own view when
// known: true there and false for the plain user means Owner + QA, false in both means Off (or
// Only me, which the QA account cannot tell apart from Off and which the registry default keeps).
// Without qa, a flag that is not released keeps its registry default.
export function localFlagModes(defaults, live, overrides = [], qa = undefined) {
  if (!live || Array.isArray(live) || typeof live !== "object" ||
      !Object.keys(live).length || !Object.values(live).every(value => typeof value === "boolean")) {
    throw new Error("Invalid plain QA flag view");
  }
  if (qa !== undefined && (!qa || Array.isArray(qa) || typeof qa !== "object" || !Object.values(qa).every(value => typeof value === "boolean"))) {
    throw new Error("Invalid QA account flag view");
  }
  const unreleased = (key, mode) => {
    if (qa === undefined) return mode;
    if (qa[key] === true) return "OWNER_AND_QA";
    return mode === "OWNER_ONLY" ? mode : "OFF";
  };
  const result = Object.fromEntries(Object.entries(defaults).map(([key, mode]) => [key, live[key] === true ? "EVERYONE" : unreleased(key, mode)]));
  for (const override of overrides) {
    const [key, mode, extra] = override.split("=");
    if (!Object.hasOwn(result, key) || !modes.includes(mode) || extra !== undefined) {
      throw new Error("Invalid --flag override: use a registry key and OFF, OWNER_ONLY, OWNER_AND_QA or EVERYONE");
    }
    result[key] = mode;
  }
  return result;
}

export const QA_ACCOUNT_STATE = path.join(process.env.HOME ?? "", ".config/hypertask-videos/storageState-qa.json");

export async function readPlainQaFlags(statePath = path.join(process.env.HOME, ".config/hypertask-videos/storageState-qa-normal.json"), fetcher = fetch) {
  const { cookies } = JSON.parse(await readFile(statePath, "utf8"));
  const cookie = cookies.filter(c => c.domain === "app.hypertask.ai" || c.domain === ".hypertask.ai")
    .map(c => `${c.name}=${c.value}`).join("; ");
  if (!cookie) throw new Error("Plain QA storage state has no app cookies");
  const response = await fetcher("https://app.hypertask.ai/api/flags", {
    headers: { Cookie: cookie }, redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Cannot read live flags with the plain QA session");
  return (await response.json()).flags;
}
