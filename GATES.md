# Gates YPER4-777

- [ ] G1 Weighted split is implemented and deterministic across input orders, covers every file once.
  CHECK: node /tmp/yper4-777/prove-split.mjs --root /home/valentin/projects/.worktrees/ci-runner-1-yper4-777
  EXPECT: PROVE-OK
- [ ] G2 The balanced plan is measured smaller than today's count split on the ten real production runs on disk.
  CHECK: node /tmp/yper4-777/prove-split.mjs --root /home/valentin/projects/.worktrees/ci-runner-1-yper4-777 --report /tmp/yper4-777/report.txt
  EXPECT: BALANCE-OK
- [ ] G3 The real CLI writes and re-checks the weighted plan end to end (plan, check, read, prove invariants).
  CHECK: node /tmp/yper4-777/cli-cycle.sh
  EXPECT: CYCLE-OK
- [ ] G4 The regression test for the weighted path exists in tests/shard-tests.test.cjs and covers balance, default weight and rejection of a moved file.
  CHECK: grep -q 'balances shards by measured work' /home/valentin/projects/.worktrees/ci-runner-1-yper4-777/tests/shard-tests.test.cjs
  EXPECT: exit 0
- [ ] G5 docs/ci.md records the measured split rule and how to refresh the weights file.
  CHECK: grep -q 'test-duration-weights' /home/valentin/projects/.worktrees/ci-runner-1-yper4-777/docs/ci.md
  EXPECT: exit 0
- [ ] G6 No test suite, build or browser ran on the VPS for this ticket; correctness is CI's decision.
  Manual.
- [ ] G7 Ten production runs after the merge show the new median and the slowest tenth (ticket Done-when).
  Manual: needs real push runs after merge, rechecked in a later run; this run cannot mint ten runs.
