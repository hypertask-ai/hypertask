# Pre-1131 flag-off baselines

These text snapshots are copied verbatim from commit `3a35c08e7~1`:

- `CachedTaskDetailNavigation.tsx.txt`: `src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx`
- `load.ts.txt`: `src/utils/controllers/taskDetail/load.ts`

The flag-off tests transpile these fixtures with their existing dependency mocks.
Keeping the baseline in the checkout makes the comparisons work in shallow CI
clones without invoking Git. The `.txt` suffix keeps historical source out of the
application's TypeScript compilation. Do not update these snapshots when changing
the current implementation.
