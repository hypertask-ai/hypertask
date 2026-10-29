# Premerge evidence status

## How a customer reaches it

The `premerge-evidence` commit status on every open pull request that targets production. Since YPER4-549 it no longer asks for a recorded test click: the poster timer sets success with the exact description `test click removed (Valentin 2026-10-21)`. This is infrastructure, with no app UI or account writes.

## How to drive it

After the change is merged and the poster timer has swept once, list every open production PR and read the newest `premerge-evidence` status on its head commit. Every PR must show success with the exact description. A PR pushed less than one sweep ago may show no status yet; read it again after the next sweep.

## What usually breaks

- The timer runs an old copy of the checker, so new heads keep the old click verdict.
- The poster skips a waiting PR because its cache key did not change.
- A closed PR, a non-production base or a short SHA gets a success status.

## What proof to collect

Checklist written before QA; the status line for every open production PR with a total; the count of recent PR heads carrying the new description; one doctor screenshot of the app signed in as a QA account. Never print tokens.

### Automated evidence

`python3 .claude/skills/ship/scripts/premerge-evidence.test.py` exercises the poster with local fixtures, including refreshing every waiting PR when checker bytes change and invalidating the cached verdict.

## Cleanup

None. Read-only.
