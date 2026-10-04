import { readFile } from "node:fs/promises";
import path from "node:path";

const modes = ["OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"];

export function localFlagModes(keys, live, overrides = []) {
  if (!live || Array.isArray(live) || typeof live !== "object" ||
      !Object.keys(live).length || !Object.values(live).every(value => typeof value === "boolean")) {
    throw new Error("Invalid plain QA flag view");
  }
  const result = Object.fromEntries(keys.map(key => [key, live[key] === true ? "EVERYONE" : "OWNER_AND_QA"]));
  for (const override of overrides) {
    const [key, mode, extra] = override.split("=");
    if (!Object.hasOwn(result, key) || !modes.includes(mode) || extra !== undefined) {
      throw new Error("Invalid --flag override: use a registry key and OFF, OWNER_ONLY, OWNER_AND_QA or EVERYONE");
    }
    result[key] = mode;
  }
  return result;
}

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
