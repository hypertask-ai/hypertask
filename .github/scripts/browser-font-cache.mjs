import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
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
  if (empty(cache)) {
    throw new Error("browser font cache empty");
  }
  mkdirSync(userFonts, { recursive: true });
  cpSync(cache, userFonts, { recursive: true });
  spawnSync("fc-cache", ["-f", userFonts], { stdio: "ignore" });
}

function selfCheck() {
  const root = mkdtempSync(path.join(tmpdir(), "font-cache-"));
  try {
    const source = path.join(root, "source", "truetype", "liberation2");
    const cache = path.join(root, "cache");
    const user = path.join(root, "user");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "LiberationSans.ttf"), "font-bytes");
    const env = {
      ...process.env,
      BROWSER_FONT_SOURCE: path.join(root, "source"),
      BROWSER_FONT_CACHE: cache,
      BROWSER_FONT_USER: user,
    };
    fillBrowserFontCache(env);
    if (!existsSync(path.join(cache, "truetype", "liberation2", "LiberationSans.ttf"))) {
      throw new Error("seeded font missing from the cache");
    }
    rmSync(path.join(root, "source"), { recursive: true, force: true });
    fillBrowserFontCache(env);
    if (!existsSync(path.join(user, "truetype", "liberation2", "LiberationSans.ttf"))) {
      throw new Error("cached font was not reused");
    }
    let rejected = false;
    try {
      fillBrowserFontCache({
        ...env,
        BROWSER_FONT_SOURCE: path.join(root, "missing"),
        BROWSER_FONT_CACHE: path.join(root, "empty-cache"),
        BROWSER_FONT_USER: path.join(root, "empty-user"),
      });
    } catch (error) {
      rejected = error.message === "browser font cache empty";
    }
    if (!rejected) throw new Error("empty font cache was accepted");
    console.log("browser font cache ready");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  if (process.argv[2] === "--self-check") selfCheck();
  else {
    try {
      fillBrowserFontCache();
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
    console.log("browser font cache ready");
  }
}
