import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const wanted = /^(liberation2?|noto|noto-core|noto-color-emoji)$/i;

export function fillBrowserFontCache(env = process.env) {
  const sourceRoot = env.BROWSER_FONT_SOURCE || "/usr/share/fonts";
  const cache = env.BROWSER_FONT_CACHE || path.join(homedir(), ".cache", "hypertask-browser-fonts");
  const userFonts = env.BROWSER_FONT_USER || path.join(homedir(), ".local", "share", "fonts", "hypertask-browser-fonts");
  mkdirSync(cache, { recursive: true });
  if (readdirSync(cache).length === 0) {
    for (const entry of readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isDirectory() || !wanted.test(entry.name)) continue;
      const source = path.join(entry.parentPath, entry.name);
      cpSync(source, path.join(cache, path.relative(sourceRoot, source)), { recursive: true });
    }
  }
  const files = readdirSync(cache, { recursive: true });
  for (const family of ["LiberationSans", "NotoColorEmoji"]) {
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
  fillBrowserFontCache();
  console.log("browser font cache ready");
}
