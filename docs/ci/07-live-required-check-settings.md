## Live required-check settings

The hourly [Required Check Settings workflow](../.github/workflows/required-check-settings.yml)
runs the dependency-free [verifier](../.github/scripts/verify-required-check-settings.mjs)
on free GitHub-hosted runners at minute 17. Manual dispatch is production-only;
checkout always uses `production`. It verifies the default branch, exactly one
active `production-required-checks` ruleset, its branch target and production
include/exclude conditions, and the exact required-context set (including both
review contexts, without aliasing). Drift and unreadable settings still fail
the monitor; this is not a required PR context. Detection can lag until the next
hourly run, plus GitHub scheduling and any rate-limit wait.

CI Tests no longer reads repository settings on PRs or production pushes.
Its optional review precheck reads commit statuses once. Read failures warn
and let tests run; an observed failed review still stops tests. Independent
required review contexts continue to block merging without approval.
Previously every production push and CI-policy PR made three settings API calls.
The hourly monitor makes three on a successful first attempt: repository
metadata, ruleset list, and one full ruleset read. Retries add calls.
GitHub REST's
[repository ruleset list](https://docs.github.com/en/rest/repos/rules#get-all-repository-rulesets)
returns summaries, not rules or ref conditions; `includes_parents` includes parent
rulesets, not full details. The
[branch rules endpoint](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch)
returns effective rules but not the name/enforcement/target/ref conditions needed
to preserve these assertions. Neither can replace the full ruleset read safely.

Reads use `gh api --include`. A rate-limited 403 or 429 waits for
`x-ratelimit-reset` / `retry-after` (the later time when both apply), logging
`rate limited, waiting Ns until reset`, then retries only that failed read.
Cumulative sleeps are capped at **3900 seconds**, longer than one full
installation window, with a 4,000-second overall budget and a 70-minute step
timeout inside the 80-minute job. A cap failure names the GitHub API rate limit in the
error and the step summary, so it is not mistaken for a test failure. Missing usable
rate-limit timing, an exceeded budget, other API errors, malformed settings, or a
settings mismatch fail the check; nothing passes without reading the settings
when verification is required. No paid runner, service, or dependency is added.

Runner CI watches use the existing `gh-app-token` helper, never the saved user
login: `token=$(gh-app-token) && test -n "$token" && GH_TOKEN="$token" gh pr checks <PR> --repo hypertask-ai/hypertask --watch --interval 120`.
Stop if minting fails; do not fall back. Refresh the token before
restarting a watch. The 120-second interval replaces gh's 10-second default;
compare observed request counts over equal windows before claiming a fleet-wide
reduction. The installation allowance used by `github.token` in Actions is a
different quota from the runner app; moving runner watches does not replenish it.
