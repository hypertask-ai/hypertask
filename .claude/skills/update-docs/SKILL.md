---
name: update-docs
description: Document live user-facing changes; FEATURE and IMPROVE tickets need the docs gate before Done
---

# update-docs

Public product docs: `~/projects/HypertaskDocs` (`hypertask-ai/docs`, public), Astro Starlight, live at https://docs.hypertask.ai. Internal engineering references live with the code in `docs/` and `.claude/skills/`; this skill is about the pages a Hypertask user reads.

## Steps

1. **Check what is live for Everyone.** Read `e2e/smoke/production-flag-modes.json` and `src/lib/flags` in the app repo. Document only behaviour live for Everyone, not Owner + QA features. If there is no user-facing change, post a ticket comment opening `No user-visible change: <reason>`.
2. **Work off `origin/main` in a docs worktree.** Find the feature's page under `src/content/docs/` with `rg`. Prefer a sentence on an existing page over a new page. Generated MCP tool reference and CLI reference pages are refreshed by the docs repo's scripts and the `docs-refs` timer; never hand-edit them.
3. **Edit the page.** Every page needs `title` and `description` frontmatter. Quote titles with colons. Use `.mdx` for imports and Starlight components (`Aside`, `Tabs`, `TabItem`, `Steps`, `Card`, `CardGrid`, `LinkCard`). Add new pages to the sidebar in `astro.config.mjs`. Check links, anchors, screenshots and examples against the live UI.
4. **Build in CI:** the PR's CI runs `npm run build`; never build on the VPS, and a killed local build is not a blocker. It first runs `scripts/check-mdx.mjs`, which names `file:line` for bare `{braces}`, unknown components, invalid frontmatter YAML and unparseable MDX. One broken page stops every deploy.
5. **Open a PR to `main`**, titled `<TICKET> [TYPE] ...`. Merging automatically runs `.github/workflows/deploy.yml`, **Build and Deploy**: build, upload to Cloudflare Pages project `hypertask-docs`, purge cache. No manual wrangler deploy and no cron; the daily changelog cron is retired.
6. **Verify live.** The docs PR must be merged and Build and Deploy green for its merge sha; check the page on https://docs.hypertask.ai. Done means `ship-check docs <T>` prints `docs ok` (or the no-user-visible-change reason is recorded).

## Writing rules

- User-facing language: what users gained, not internal implementation. No ticket numbers, PR numbers, flag keys or internal links in page text.
- Technical but approachable. Code examples before explanations; tables for parameters and comparisons; `<Aside>` for notes and warnings; `<Tabs>` for multi-client examples. Keep the dark purple theme matching hypertask.ai.
- Descriptions and API code examples use HTML, matching Hypertask's API. MCP examples use `https://mcp.hypertask.ai`.

## Changelog

Edit `src/content/docs/changelog/index.mdx` only for shipped, user-facing changes. Source: Product board (project 15), HTPR only. Each item links to its ticket: `[HTPR-XXXX](https://app.hypertask.ai/detail/project-15/{number})`. Feature pages carry no ticket identifiers.

- No privacy-sensitive items, cross-tenant data bugs, internal-only work or test tickets (including "testtask").
- Frame fixes as **Fixed: X**, never "Bug: X was broken."
- Categories: Bug Fixes, Improvements, New Features, Infrastructure (only user-relevant items such as MCP).
- Newest day first, `## Month Day, Year` headings.
