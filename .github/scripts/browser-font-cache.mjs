import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const wanted = /^(liberation2?|noto|noto-core|noto-color-emoji)$/i;

function empty(dir) {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

function listWanted(root) {
  const found = [];
  function walk(dir, depth) {
    if (depth > 4 || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const target = path.join(dir, entry.name);
      if (wanted.test(entry.name)) found.push(target);
      else walk(target, depth + 1);
    }
  }
  walk(root, 0);
  return found;
}

export function fillBrowserFontCache(env = process.env) {
  const sourceRoot = env.BROWSER_FONT_SOURCE || "/usr/share/fonts";
  const cache = env.BROWSER_FONT_CACHE || path.join(homedir(), ".cache", "hypertask-browser-fonts");
  const userFonts = env.BROWSER_FONT_USER || path.join(homedir(), ".local", "share", "fonts", "hypertask-browser-fonts");
  mkdirSync(cache, { recursive: true });
  if (empty(cache)) {
    for (const source of listWanted(sourceRoot)) {
      const rel = path.relative(sourceRoot, source);
      cpSync(source, path.join(cache, rel), { recursive: true });
    }
  }
  const files = readdirSync(cache, { recursive: true });
  for (const family of ["LiberationSans", "NotoSans", "NotoColorEmoji"]) {
    if (!files.some((file) => new RegExp(`(^|[/\\\\])${family}(?:-Regular)?\\.ttf$`, "i").test(file))) {
      throw new Error(`browser font cache missing ${family}`);
    }
  }
  mkdirSync(userFonts, { recursive: true });
  cpSync(cache, userFonts, { recursive: true });
  const result = spawnSync("fc-cache", ["-f", userFonts], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`browser font registration failed: ${result.error?.message || result.status}`);
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    fillBrowserFontCache();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log("browser font cache ready");
}
