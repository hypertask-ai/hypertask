# Secret scan (YPER4-324)

Keys never reach a repo the agents push to.

- `install`: run once per machine user. Every commit on that machine runs `scan-staged` (gitleaks on the staged change) first, then the repo's own hook. Husky repos are covered through husky's `init.sh` in the user's config folder (only when the repo has a `.husky/pre-commit` file). Test: `sh scripts/secret-scan/install.test.sh`.
- `gitleaks.toml`: the base rules: gitleaks defaults plus two rules for keys the defaults missed (a Cloudflare token in a markdown table leaked that way). Copy it to `.gitleaks.toml` in every repo; the local hook uses it for repos without one.
- `gitleaks.yml`: copy to `.github/workflows/gitleaks.yml` in every repo agents push to. It scans the commits each push or pull request adds, against the repo's default branch.
- A known false positive goes in that repo's `.gitleaks.toml` allowlist with a comment saying why.
