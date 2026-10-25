# Preview exception and readiness

Read [Repository Workflow](workflow.md#repository-workflow) for shared-database, no-stash, polling and branch rules. Global departments.md and browser.md govern browser scope: product runners do not use Valentin's browser; their QA is headless. Global safety and verify-qa forbid using Valentin's login or cookies.

Every pushed branch already gets one; never create another (enforced: `.claude/hooks/preview-guard.sh`; an exception needs Valentin's recorded yes on the ticket, then `touch /tmp/ht-preview-approved`, removed when done).

When an approved preview is ready, open it in zsb with your own identity or the QA account and confirm you are in the app, not on the login page.
