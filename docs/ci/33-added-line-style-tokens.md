## Added-line style tokens (YPER4-714)

The existing `ci-checks` job runs `npm run lint:styles -- <base-sha> <head-sha>`
on PRs, using the merge base and exact head with full Git history.
Production-only edits are excluded. ESLint parses component attributes;
PostCSS SCSS parses stylesheets. Only added lines fail for literal colors,
raw Tailwind palette classes or arbitrary typography. Theme custom-property
owners may define raw tokens. Existing debt and deletions remain allowed,
without borrowing per-file suppression counts. No job or status is added.
