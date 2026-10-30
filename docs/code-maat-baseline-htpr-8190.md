# HTPR-8190: change-coupling baseline

This is a measurement, not a refactor or an ownership policy. Co-changes are
proxies: they do not measure merge conflicts, throughput, or causal dependency.
The window is committer time, 2026-10-01T00:00:00Z inclusive through
2026-10-30T00:00:00Z exclusive, reachable from
`4c1777e08431308d563cc7c7e12ffda806004301`. Git's short display date uses
commits' author time zones and can show October 30 within that UTC window.
Git's log contains 1,616 commit headers; code-maat reports 1,597 commits
with parsed changes. Merge commits without numstat changes explain the difference
in scope, not a throughput measurement.

Official code-maat 1.0.4 `git2`, with its default thresholds, reports 1,597
commits, 5,796 entities, 16,892 entity changes, and seven Git authors. Git
authors are not necessarily people. No author identities are reported here.

## Most changed entities

| Entity | Revisions |
| --- | ---: |
| `tests/feature-flags.test.cjs` | 178 |
| `e2e/smoke/production-flag-modes.json` | 137 |
| `src/lib/flags.ts` | 124 |
| `src/lib/flags/keys.ts` | 117 |
| `.claude/skills/ship/SKILL.md` | 88 |
| `docs/ci.md` | 61 |
| `.claude/skills/verify-qa/reference/feature-map/INDEX.md` | 60 |
| `package-lock.json` | 54 |
| `docs/ci-policy.yml` | 51 |
| `.claude/skills/ship/scripts/ship-check` | 50 |

`src/lib/flags/keys.ts` is four lines at the snapshot. YPER4-237 split the
registry in commit `6b2524490` on 2026-10-10. The window spans that change;
these historical counts do not justify repeating the registry refactor.

## Meaningful co-change pairs

Degree is code-maat's coupling percentage; average revisions provides context.
Tests and fixtures changing with their implementation can be healthy, rather
than evidence of an ownership problem.

| Entities | Degree | Average revisions |
| --- | ---: | ---: |
| `src/lib/ai/prompts/definitions.ts` / `tests/fixtures/ai/prompt-baseline.json` | 100% | 14 |
| `src/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton.tsx` / `tests/new-task-button.test.cjs` | 100% | 8 |
| `src/pages/api/search/values.ts` / `tests/search-chips-values.test.cjs` | 100% | 8 |
| `config/parity/contract.json` / `docs/parity.md` | 97% | 25 |
| `.claude/skills/ship/scripts/ship-check` / `.claude/skills/ship/scripts/ship-check.test.sh` | 87% | 47 |
| `src/components/Modals/commands/HTC/AllCommands.ts` / `src/components/Modals/commands/HTC/commands.tsx` | 48% | 23 |

The shared `src/components/Modals/commands/HTC/commands.tsx` has 40 revisions.
AI removal HTPR-7859 (PR 2150) and inbox triage HTPR-8044 (PR 2312) both
changed it. This is a concrete overlap, not a measured conflict.

## Proposed next map

These are candidates for investigation, not enforced domains or leases:

- Flags: definitions, registry consumers, flag tests, and production modes.
- Commands: command registration and its shared UI; inspect the AI and inbox overlap.
- Search: values endpoint and its search tests.
- AI prompts: definitions and the baseline fixture.
- Shipping: `ship-check`, its tests, and CI policy documentation.
- Parity: contract and documentation.

Validate boundaries against current code and active work before any change.
Make each later step a separate small PR.

## Reproduce

Supply a trusted official [code-maat 1.0.4](https://github.com/adamtornhill/code-maat/releases/tag/v1.0.4)
standalone JAR explicitly. The tool checks its SHA-256; it never downloads one.
Requires Git, Java, Python 3, and the snapshot's Git history. Create an empty,
caller-owned directory outside every Git worktree, then run:

```sh
mkdir /tmp/my-code-maat-baseline
python3 scripts/analysis/code-maat-baseline.py --jar /path/to/code-maat-1.0.4-standalone.jar --output /tmp/my-code-maat-baseline
```

The tool writes summary, revisions, and coupling CSVs plus a Markdown report.
It rejects malformed output even if Java exits successfully. Git history is
kept only in a temporary file, not in the report directory. File paths may
still contain sensitive information; share outputs only after review.
