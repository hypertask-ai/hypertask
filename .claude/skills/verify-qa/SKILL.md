---
name: verify-qa
description: After deployment, verify real production behavior and record proof before closing the ticket.
---

# Verify production

## Goal and proof bar

Verify your change on `https://app.hypertask.ai` after deployment. Drive real entry points and prove saved results survive reload. Mocks, previews, passing tests and merged PRs are not live proof. Follow [Lauren Tan's verification pattern](https://github.com/poteto/verification-skill-example).

Never use Valentin's login or browser. Use headless Playwright. Never print credentials. Never build or install app packages on the VPS.

## Steps

1. Read the ticket's acceptance criteria. Pick its [feature-map page](reference/feature-map/INDEX.md). Update missing or changed recipes in the PR. Write a checklist before testing. For tools, test the parse or dispatch entry point, not only helpers.
2. Select the account with `.claude/skills/verify-qa/scripts/qa-login`: `flags` (default), `plain` (flag-off), `free`, `byok`, `pro`, `owner`, `member` or `guest`. It prints the user ID, state path and refresh route, never credentials. Use `.claude/skills/verify-qa/scripts/qa-login flags --state` for the path alone. Follow [login checks and refresh](reference/logins.md). Admin pages are not agent-testable.
3. Run the doctor. Require Production deployment `success` for the latest merge SHA. Capture signed-in `/my-tasks` using [phone-shot.sh](../verify-on-phone/scripts/phone-shot.sh), passing `--state` explicitly. On login landings, run `.claude/skills/verify-qa/scripts/qa-identity <state> --expect <id>`: `identity ok` means fix state loading; only `identity expired` means refresh. Do not judge the feature before doctor passes.
4. Every app deploy: run `node .claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <run-folder>/inbox-cycle`. Require `inbox-cycle ok`; include its evidence in Cases.
5. Exercise affected success, cancel, error, empty and reload paths. Check declared flag mode and flag-off behavior; use [flag policy](../../reference/flags.md). For changed UI, capture 1440x900 and 390x844 in Porcelain, Graphite, AMOLED and Dia, plus a short main-path video. Compare before/after. Record inaccessible paths as `UNREACHABLE`, with reason and closest real check. Clean up only your fixtures through product surfaces.
6. Save evidence under `~/.local/state/vcc-evidence/<TICKET>/<YYYY-MM-DD>-qa-run-<n>/`. Follow [storage rules](reference/evidence-storage.md). Write `<TICKET>/proof.md`:

   ```text
   Feature map: .claude/skills/verify-qa/reference/feature-map/<page>.md
   Doctor: sha <latest-merge-sha> deployment success; /my-tasks signed in as user <id>
   Run: <YYYY-MM-DD>-qa-run-<n>

   ## Cases
   - PASS: <case> -> <nonempty-file-in-run-folder>
   - UNREACHABLE: <case> -> <reason; closest real check>
   ```

7. Run `.claude/skills/ship/scripts/ship-check proof <TICKET>`. Require `proof ok`; it checks merge SHA, format, run files and screenshots. A FAIL case cannot pass. This validates records, not behavior.
8. Publish the self-contained HTML QA report as a ticket page through `vcc pages create`. Post one `--kind qa` verdict using `verify-qa`, report link, proof and key attachments. Read back. PASS: explain what changed, then Done. FAIL: keep In Progress, switch flagged failure Off through [ship](../ship/SKILL.md), repair and repeat. After two failed repairs, record both attempts and the next action in ticket agent activity. Move technical blocks to `Agent Blocked` on board 4060 or `Agent Blocked (Infra)` on board 15, naming HT Product Lead. Keep waiting-on for people only; decisions, money, keys or access go to Valentin Review with one Question. Never invent a pass.
