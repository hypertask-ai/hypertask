---
name: update-docs
description: Any ticket that changes what a user sees or how a feature works, before opening the PR
---

# update-docs

Public product docs live in a **separate repo from the app**: `~/projects/HypertaskDocs` (remote `hypertask-ai/docs`), built with Astro Starlight and published at `https://docs.hypertask.ai`. They are not the same thing as `openwiki/` inside `~/projects/hypertasks` — that is the internal engineering wiki for agents working the codebase, covered by the separate `openwiki-refresh` skill. This skill is about the pages a Hypertask user reads.

This skill absorbs the standing job of the retired "Hypertask Docs" board agent. Its rules below come from that repo's own `CLAUDE.md`, carried over verbatim rather than paraphrased.

## Steps

1. **Find the page for the touched feature.** Grep the docs repo for the feature's name or the UI copy you changed:
   ```
   grep -ril "<feature keyword>" ~/projects/HypertaskDocs/src/content/docs/
   ```
   Pages are grouped by area: `getting-started/`, `features/`, `mcp/`, `api/`, `cli/`, `design-system/`, `changelog/`. If nothing matches an existing page, decide whether the change belongs on an existing page or needs a new one — don't create a page for something one sentence on an existing page already covers.
2. **Edit or create the `.mdx` file** in `src/content/docs/`. Every file needs frontmatter (`title`, `description`). If the page uses an `import` (Starlight components: `Aside`, `Tabs`, `TabItem`, `Steps`, `Card`, `CardGrid`, `LinkCard`), it must be `.mdx`, not `.md`. Descriptions and code examples use **HTML**, matching Hypertask's own API convention, not Markdown.
3. **Adding a new page:** also add it to the sidebar in `astro.config.mjs`, or it exists but nobody can navigate to it.
4. **If the ticket also needs a changelog entry**, edit `src/content/docs/changelog/index.mdx` following the rules under "Hypertask Docs mission" below. Not every ticket needs one — only a user-facing fix, improvement, or feature that shipped.
5. **Open a PR in `hypertask-ai/docs`** (base `main`) alongside the app PR. The two repos are independent; there is no shared PR. Link both PRs in the ticket comment with real `<a href>` URLs, never bare text. (The docs repo's own CI tolerates a direct push to `main` too — `build-check.yml` runs on push as well as PR, because agents have historically pushed straight to main — but opening a PR keeps the doc change reviewable alongside the code change, so do that by default.)
6. **Deploy.** The Cloudflare Pages project `hypertask-docs` is direct-upload only: merging the PR does **not** deploy it. After merge, run:
   ```
   cd ~/projects/HypertaskDocs && npm run build
   CLOUDFLARE_ACCOUNT_ID=6031a7dff0d4a6469414cfa8a6dedddf npx wrangler pages deploy dist --project-name hypertask-docs --branch main
   ```
   A daily cron (`scripts/daily-changelog.sh`) does this automatically for changelog-only updates, but a feature-page edit needs the manual deploy above — don't wait for the cron to notice it.

## Check before hand-off

- `npm run build` in `~/projects/HypertaskDocs` exits clean. This is the same command `build-check.yml` runs in CI — if it fails locally, it fails there too, and per that workflow's own comment, a broken build means `docs.hypertask.ai` silently serves whatever was published last until someone notices.
- Any link you added (to another page, an anchor, or the sidebar) actually resolves.
- If the UI changed, the doc page's screenshot or embedded example reflects the new UI, not the old one.
- If you touched the changelog, it names only `HTPR-*` tickets, contains no privacy-sensitive or test-ticket content, and links to the real ticket URL.

## Hypertask Docs mission (source: `hypertask-ai/docs` `CLAUDE.md`, carried over from the retired Hypertask Docs board agent)

- Every `.mdx` file needs frontmatter (`title`, `description`); use Starlight components for rich content; a page with an `import` must be `.mdx`.
- Descriptions and code examples use HTML format, matching Hypertask's API.
- The CF Pages project is direct-upload only — `git push` does not deploy; deploy explicitly with the `wrangler pages deploy` command above.
- **Changelog source is the Hypertask Product board (project 15) only.** Only `HTPR-*` tickets — ignore every other prefix (`ANAL-`, `BBAB-`, `VETS-`, `IKNO-`, `INNE-`, etc.).
- **No privacy-sensitive content.** Never mention bugs about user data leaking between boards or accounts, or similar cross-tenant issues, in the changelog. Internal bugs, not public changelog items.
- **No test tasks.** Skip tickets titled like "test", "testtask", or similar.
- **Reframe bugs as fixes:** "Fixed: X", never "Bug: X was broken."
- **User-facing language only** — what users gained, not what was broken internally.
- **Categories:** Bug Fixes, Improvements, New Features, Infrastructure (only if user-relevant, e.g. the MCP server — not internal tooling).
- **Format:** each day gets a `## {Month} {Day}, {Year}` heading, newest at the top. Each item links to its ticket: `[HTPR-XXXX](https://app.hypertask.ai/detail/project-15/{numericId})`.
- **Style guide:** dark purple theme matching hypertask.ai; technical but approachable tone; code examples before explanations; tables for parameter lists and comparisons; `<Aside>` for notes/warnings; `<Tabs>` for multi-client examples (Claude Desktop, Claude Code, Cursor); API examples use `https://mcp.hypertask.ai` as the base URL.
