# Secret scan (YPER4-324)

Keys never reach a repo the agents push to.

- `install`: run once per machine user. Every commit on that machine runs `scan-staged` (gitleaks on the staged change) first, then the repo's own hook. Husky repos are covered through husky's `init.sh` in the user's config folder. Test: `sh scripts/secret-scan/install.test.sh`.
- `gitleaks.yml`: copy to `.github/workflows/gitleaks.yml` in every repo agents push to. It scans the commits each push or pull request adds, against the repo's default branch.
- A known false positive goes in that repo's `.gitleaks.toml` allowlist with a comment saying why.
