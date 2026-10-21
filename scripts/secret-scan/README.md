# Secret scan (YPER4-324)

Keys never reach a repo the agents push to.

- `install`: run once per machine user. Every commit on that machine runs `scan-staged` (gitleaks on the staged change) first, then the repo's own hook. Husky repos are covered through husky's `init.sh` in the user's config folder (only when the repo has a `.husky/pre-commit` file). Test: `sh scripts/secret-scan/install.test.sh`.
- `gitleaks.toml`: the base rules: gitleaks defaults plus two rules for keys the defaults missed (a Cloudflare token in a markdown table leaked that way). Copy it to `.gitleaks.toml` in every repo; the local hook uses it for repos without one.
- `install-workflow`: run `sh scripts/secret-scan/install-workflow /path/to/repo` for every repo agents push to, instead of copying `gitleaks.yml` by hand. Requires an authenticated `gh`; reads visibility from the checkout's `origin` and installs `.github/workflows/gitleaks.yml` with `ubuntu-latest` for PUBLIC repos or `[self-hosted, ci-fast]` for PRIVATE/INTERNAL repos. Private/internal repos need an available runner with those labels. Unknown or unreadable visibility refuses installation without changing an existing workflow. The workflow scans the commits each push or pull request adds, against the repo's default branch. Test: `sh scripts/secret-scan/install-workflow.test.sh`.
- A known false positive goes in that repo's `.gitleaks.toml` allowlist with a comment saying why.
