---
name: verify-qa
description: After deployment, verify real production behavior and record proof before closing the ticket.
---

# Verify production

## Goal and proof bar

Verify `https://app.hypertask.ai` after deployment. Drive entry points; prove saved results survive reload. Mocks, previews, tests and merged PRs aren't live proof. Follow [Lauren Tan's verification pattern](https://github.com/poteto/verification-skill-example).

Never use Valentin's login or browser. Use headless Playwright. Never print credentials. Never build or run tests on the VPS; use CI. Killed local runs aren't blockers.

Local launch and teardown: [recipe](reference/local-launch.md).

## Optional pre-PR check

Push, then run `scripts/verify-qa <branch> inbox-cycle`. It uses GitHub-hosted fixtures, not the VPS or production data. Mint a fresh `gh-app-token` for GitHub; never fall back to human login. Follow the returned run URL with one `gh run watch`, then download artifacts. `inbox-cycle-broken` proves failure propagation. `hands-free-drives` adds both drive scripts and their broken-shortcut controls. This optional check never replaces live QA. See [CI limits](../../../docs/ci.md).

## Steps

1. Read the ticket's acceptance criteria. Pick the [customer](reference/feature-map/INDEX.md) or [ops](reference/ops-map/INDEX.md) recipe. Update missing or changed recipes in the PR. Write a checklist before testing. For tools, test the parse or dispatch entry point, not only helpers.
2. Select the account with `.claude/skills/verify-qa/scripts/qa-login`: `flags` (default), `plain` (flag-off), `free`, `byok`, `pro`, `owner`, `member` or `guest`. It prints the user ID, state path and refresh route, never credentials. Use `.claude/skills/verify-qa/scripts/qa-login flags --state` for the path alone. Follow [login checks and refresh](reference/logins.md). Admin pages are not agent-testable.
3. Run the doctor. Require Production deployment `success` for the latest merge SHA. Capture signed-in `/my-tasks` using [phone-shot.sh](../verify-on-phone/scripts/phone-shot.sh), passing `--state` explicitly. On login landings, run `.claude/skills/verify-qa/scripts/qa-identity <state> --expect <id>`: `identity ok` means fix state loading; only `identity expired` means refresh. Do not judge the feature before doctor passes.
4. Every app deploy: run `node .claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <run-folder>/inbox-cycle`. Require `inbox-cycle ok`; include its evidence in Cases.
5. Exercise affected success, cancel, error, empty and reload paths. Check declared flag mode and flag-off behavior; use [flag policy](../../reference/flags.md). For changed UI, run [verify-design](../verify-design/SKILL.md) against the ticket frame in every theme; capture 390x844 plus a short main-path video. Compare before/after. Record inaccessible paths as `UNREACHABLE`, with reason and closest real check. Clean up only your fixtures through product surfaces: [fixture cleanup](reference/fixture-cleanup.md).
6. Save evidence under `~/.local/state/vcc-evidence/<TICKET>/<YYYY-MM-DD>-qa-run-<n>/`. Follow [storage rules](reference/evidence-storage.md). Write `<TICKET>/proof.md`:

   ```text
   Feature map: .claude/skills/verify-qa/reference/feature-map/<page>.md
   Doctor: sha <latest-merge-sha> deployment success; /my-tasks signed in as user <id>
   Run: <YYYY-MM-DD>-qa-run-<n>

   ## Cases
   - PASS: <case> -> <nonempty-file-in-run-folder>
   - UNREACHABLE: <case> -> <reason; closest real check>
   ```

7. Cover every acceptance and breakage bullet with evidence. Another runner re-runs the drive script. Require `proof ok` from `.claude/skills/ship/scripts/ship-check proof <TICKET>`. See [proof coverage](reference/ops-map/proof-coverage.md).
8. Publish the self-contained HTML QA report as a ticket page through `vcc pages create`. Post one `--kind qa` verdict with report link, proof and attachments. Read back. PASS: explain what changed, then Done. FAIL: keep In Progress; follow [ship](../ship/SKILL.md) for flagged failures. Repair and repeat. After two failed repairs, use its ticket-only handoff; do not message a lead. Never invent a pass.
