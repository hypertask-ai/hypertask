# Ops map for QA verification

Build, release, runner and monitoring recipes. For customer-facing paths,
use the [feature map](../feature-map/INDEX.md). These checks do not replace
production QA of an app change.

| Area | File | Proof |
|---|---|---|
| CI Node-version guard | [ci-node-version.md](ci-node-version.md) | throwaway PR negative control, no app writes |
| Visual Regression check | [visual-regression.md](visual-regression.md) | dispatch on production one run at a time, 3 green on one commit, per-screen capture times, no app writes |
| Production build and deploy | [production-build.md](production-build.md) | Vercel build log of the merge sha, no app writes |
| Premerge evidence status | [premerge-evidence.md](premerge-evidence.md) | read-only status sweep of open PRs, no app writes |
| PR queue picker | [pr-drain-picker.md](pr-drain-picker.md) | installed dry-run queue selection; no PR claims or board writes |
| Runner dispatch | [runner-dispatch.md](runner-dispatch.md) | read-only plan from the live copy, no --go, no app writes |
| Secret scan workflow installer | [secret-scan-workflow.md](secret-scan-workflow.md) | temp checkouts from merged production, no app writes |
| PostHog error alerts | [posthog-error-alerts.md](posthog-error-alerts.md) | nightly canary workflow, closes its own ticket |
| Signup check (hypertask.app) | [signup-check.md](signup-check.md) | Access service identity, read-only, daily counts snapshot |
