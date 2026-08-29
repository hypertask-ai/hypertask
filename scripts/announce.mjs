#!/usr/bin/env node
// Owner CLI for in-app announcements. Wraps the secured admin endpoints so the
// owner can manage announcements without any in-app UI.
//
// Auth : ANNOUNCEMENTS_SECRET_KEY env var, sent as `Authorization: Bearer <secret>`.
//        (Must match ANNOUNCEMENTS_SECRET_KEY set in the app's Vercel env.)
// Base : ANNOUNCE_BASE_URL env var, default https://app.hypertask.ai
//
// Usage:
//   ANNOUNCEMENTS_SECRET_KEY=… node scripts/announce.mjs list
//   ANNOUNCEMENTS_SECRET_KEY=… node scripts/announce.mjs create --title "Title" --content "Body text" [--blog-url https://…] [--new-users]
//   ANNOUNCEMENTS_SECRET_KEY=… node scripts/announce.mjs slides --file body.json
//   ANNOUNCEMENTS_SECRET_KEY=… node scripts/announce.mjs edit --id 42 --file body.json
//   ANNOUNCEMENTS_SECRET_KEY=… node scripts/announce.mjs delete --id 42
//
// --new-users marks the announcement as a welcome/new-user one (isWelcome);
//   the backend currently targets its internal allowlist for those.
// Add --dry-run to any write to print the request instead of sending it.
//
// `body.json` for slides/edit is the announcement body, e.g.:
//   { "title": "…", "content": "…", "blogURL": "…", "newUserMark": false,
//     "slides": [ { "headline": "…", "content": "<p>…</p>", "mediaURL": "…",
//                   "articleURL": "…", "primaryCTA": "Learn more" } ] }

import { readFileSync } from "node:fs";
import assert from "node:assert";

const BASE = process.env.ANNOUNCE_BASE_URL || "https://app.hypertask.ai";
const POST_URL = "/api/admin/postAnnouncement";
const UPDATE_URL = "/api/admin/announcements/updateAnnouncement";
const LIST_URL = "/api/admin/announcements/getAnnouncements";

// selftest flips this so a rejected input can be asserted instead of exiting the process.
let throwOnFail = false;

function fail(msg) {
  if (throwOnFail) throw new Error(msg);
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else args[key] = next, i++;
    } else args._.push(a);
  }
  return args;
}

function parseId(v, cmd) {
  // Strict: reject "12oops" / "1e3" so a typo can't target the wrong announcement.
  if (!/^\d+$/.test(String(v))) fail(`${cmd} requires --id <positive integer>`);
  return parseInt(v, 10);
}

// The announcement ladder. Every level lands in the rocket sidebar; the level only
// decides how loudly it interrupts on top of that. Mirrors resolveLevel() in
// src/models/Announcements/model.ts.
const LEVELS = ["note", "link", "video", "banner", "takeover"];

function str(a, flag) {
  const v = a[flag];
  if (v === undefined) return undefined;
  if (typeof v !== "string") fail(`--${flag} requires a value`);
  return v;
}

function buildCreateBody(a) {
  // A flag with no value parses to boolean true; require real string values.
  if (typeof a.title !== "string" || typeof a.content !== "string")
    fail("create requires --title and --content, each with a value");
  const jsonBody = { title: a.title, content: a.content };

  const blogURL = str(a, "blog-url");
  const mediaURL = str(a, "media-url");
  const articleURL = str(a, "article-url");
  const primaryCTA = str(a, "cta");
  const level = str(a, "level");

  if (level !== undefined) {
    if (!LEVELS.includes(level))
      fail(`--level must be one of: ${LEVELS.join(", ")}`);
    if (level === "takeover")
      fail("--level takeover needs slides: use `slides --file body.json` instead");
    // Publish nothing that renders empty: each rung needs its own payload.
    if (level === "link" && !blogURL)
      fail("--level link requires --blog-url (the sidebar row is the link)");
    if ((level === "video" || level === "banner") && !mediaURL)
      fail(`--level ${level} requires --media-url (the video or screenshot)`);
    if (primaryCTA && !articleURL)
      fail("--cta is the button label, so it also requires --article-url");
    jsonBody.level = level;
  }

  if (blogURL) jsonBody.blogURL = blogURL;
  if (mediaURL) jsonBody.mediaURL = mediaURL;
  if (articleURL) jsonBody.articleURL = articleURL;
  if (primaryCTA) jsonBody.primaryCTA = primaryCTA;
  if (a["new-users"]) jsonBody.newUserMark = true;
  return { jsonBody };
}

function readBodyFile(a, { forEdit } = {}) {
  if (!a.file || typeof a.file !== "string")
    fail("this command requires --file <body.json>");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(a.file, "utf8"));
  } catch (e) {
    fail(`could not read/parse ${a.file}: ${e.message}`);
  }
  if (typeof parsed !== "object" || parsed === null || !parsed.title)
    fail(`${a.file} must be a JSON object with at least a "title"`);
  if (parsed.level !== undefined && !LEVELS.includes(parsed.level))
    fail(`${a.file}: "level" must be one of: ${LEVELS.join(", ")}`);
  // edit replaces the WHOLE stored body; a title-only file would wipe the rest.
  const hasSlides = Array.isArray(parsed.slides) && parsed.slides.length > 0;
  if (forEdit && !parsed.content && !hasSlides)
    fail(
      `${a.file}: edit overwrites the entire announcement body. Include "content" and/or "slides" or you will wipe the existing announcement.`
    );
  return parsed;
}

async function api(method, path, body, dryRun) {
  if (dryRun) {
    console.log(`${method} ${BASE}${path}`);
    if (body) console.log(JSON.stringify(body, null, 2));
    return null;
  }
  if (!process.env.ANNOUNCEMENTS_SECRET_KEY) fail("ANNOUNCEMENTS_SECRET_KEY env var is required");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANNOUNCEMENTS_SECRET_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) fail(`HTTP ${res.status}: ${text}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  const dryRun = !!a["dry-run"];

  switch (cmd) {
    case "list": {
      const rows = (await api("GET", LIST_URL)) || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log("(no announcements)");
        return;
      }
      for (const r of rows) {
        const title = r.body?.title ?? "(no title)";
        const date = new Date(r.createdAt).toISOString().slice(0, 10);
        const active = r.isActive ? "active" : "inactive";
        const slides = r.body?.slides?.length ? ` [${r.body.slides.length} slides]` : "";
        console.log(`#${r.id}\t${date}\t${active}\t${title}${slides}`);
      }
      return;
    }
    case "create": {
      const body = buildCreateBody(a);
      await api("POST", POST_URL, body, dryRun);
      if (!dryRun) console.log("created");
      return;
    }
    case "slides": {
      const jsonBody = readBodyFile(a);
      await api("POST", POST_URL, { jsonBody }, dryRun);
      if (!dryRun) console.log("created");
      return;
    }
    case "edit": {
      const id = parseId(a.id, "edit");
      const jsonBody = readBodyFile(a, { forEdit: true });
      await api("POST", UPDATE_URL, { jsonBody, announcementId: id }, dryRun);
      if (!dryRun) console.log("updated");
      return;
    }
    case "delete": {
      const id = parseId(a.id, "delete");
      await api("DELETE", `${UPDATE_URL}?announcementId=${id}`, null, dryRun);
      if (!dryRun) console.log("deleted");
      return;
    }
    case "selftest": {
      // ponytail: single runnable check for the non-trivial bits (arg parse + body build).
      assert.deepStrictEqual(
        parseArgs(["create", "--title", "Hi", "--new-users"]),
        { _: ["create"], title: "Hi", "new-users": true }
      );
      assert.deepStrictEqual(
        buildCreateBody({ title: "T", content: "C", "blog-url": "u", "new-users": true }),
        { jsonBody: { title: "T", content: "C", blogURL: "u", newUserMark: true } }
      );
      assert.deepStrictEqual(
        buildCreateBody({ title: "T", content: "C" }),
        { jsonBody: { title: "T", content: "C" } }
      );
      // ladder: a valid banner carries its media and CTA
      assert.deepStrictEqual(
        buildCreateBody({
          title: "T",
          content: "C",
          level: "banner",
          "media-url": "m",
          "article-url": "a",
          cta: "Try it now",
        }),
        {
          jsonBody: {
            title: "T",
            content: "C",
            level: "banner",
            mediaURL: "m",
            articleURL: "a",
            primaryCTA: "Try it now",
          },
        }
      );
      // ladder: every rung that would render empty is refused
      throwOnFail = true;
      for (const bad of [
        { title: "T", content: "C", level: "nope" },
        { title: "T", content: "C", level: "takeover" },
        { title: "T", content: "C", level: "link" },
        { title: "T", content: "C", level: "video" },
        { title: "T", content: "C", level: "banner" },
        { title: "T", content: "C", level: "note", cta: "Go" },
      ]) {
        assert.throws(() => buildCreateBody(bad), Error);
      }
      throwOnFail = false;
      console.log("selftest ok");
      return;
    }
    default:
      console.log(
        [
          "in-app announcement owner CLI",
          "",
          "commands: list | create | slides | edit | delete | selftest",
          "  create --title T --content C [--level L] [--new-users]",
          "  slides --file body.json      (level 5, takeover)",
          "",
          "the ladder — every level shows in the rocket sidebar; the level only",
          "decides how loudly it interrupts on top of that:",
          "  --level note                                  sidebar only, nothing to click",
          "  --level link     --blog-url URL               row opens the blog post",
          "  --level video    --media-url URL              row opens the video",
          "  --level banner   --media-url URL [--article-url URL] [--cta LABEL]",
          "                                                row + the corner card, once",
          "  (takeover)       slides --file body.json      row + the full slides modal",
          "",
          "omitting --level keeps the old implicit behaviour and never interrupts.",
          "",
          "  edit --id N --file body.json",
          "  delete --id N",
          "  add --dry-run to any write to preview the request",
          "",
          "env: ANNOUNCEMENTS_SECRET_KEY (required), ANNOUNCE_BASE_URL (default prod)",
        ].join("\n")
      );
      if (cmd) process.exit(1);
  }
}

main().catch((e) => fail(e.message));
