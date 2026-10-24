# Gates: production browser smoke fixture

Scope: Diagnose the deployed QA fixture failure, repair only smoke infrastructure as QA, open the requested production PR, prove branch smoke and checks, and leave it unmerged. This helper cannot write to the board; evidence is handed to the owning runner.

- [x] G0: This ledger has valid falsifiable gates
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries

- [x] G1: The production run identifies the exact unavailable QA fixture and access reason
  CHECK: node .unlazy/verify.cjs root-cause
  EXPECT: root-cause verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=92f936e8b9604b938d6c151fd0e1f8706e0d6e3094036b31eeac6711e01aee69; exit=0; EXPECT=matched; output-sha256=c61cfb5d5f25e7159913bb497c0e8ba9976cd6948a70743dea5f6ba7ab69d0af; output-bytes=20; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries

- [x] G2: The smoke uses a real private QA-owned fixture with a visible normal ticket and changes only smoke infrastructure
  CHECK: node .unlazy/verify.cjs fixture
  EXPECT: fixture verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=4118bc0a44be6e82004f341bf7e6c72280b084dac86229ad6ad394a75df6aafc; exit=0; EXPECT=matched; output-sha256=904c23ef7eff7089830e96bff47d52a3d96dcefb32b50fa04aeb4f489ce1576b; output-bytes=17; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries

- [x] G3: Targeted smoke regression tests pass
  CHECK: node --test tests/postdeploy-browser-smoke.test.cjs tests/qa-session-renewal.test.cjs tests/prod-smoke-alarm*.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=4292729d5df64c1597d17294e90d6a54dae1d548f4cea1c04133417416f6c673; exit=0; EXPECT=matched; output-sha256=091cb4ca18f48795dd940dac0943eb94b30ae72f45c0f88bbe929638f998c6f5; output-bytes=8248; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries

- [x] G4: The requested branch originates from fetched production and contains the exact requested commit title with no unrelated changes
  CHECK: node .unlazy/verify.cjs branch
  EXPECT: branch verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=d05c9f0e23e671966739c0527870cbb687735d2d5815e46cafa5c272fe8709bd; exit=0; EXPECT=matched; output-sha256=be479df5709606cf401cfa171fbe2915618e863f14acf2379f789c29edf439d7; output-bytes=16; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries

- [x] G5: The open production PR has the requested title and plain-language body format, no em dashes, and no auto-merge
  CHECK: node .unlazy/verify.cjs pr
  EXPECT: pr verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=4e2c9fcb507e3385ff71aa87a8588661a9ddc403fbc6d5a726baaf3e5343bf3e; exit=0; EXPECT=matched; output-sha256=3a1d314c0ea381b2155efa25de61e833986bcfceb4b5c39bcf6c8eb3f51dd40c; output-bytes=12; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries

- [x] G6: Current-head required checks including AI review pass with no outstanding MAJOR findings
  CHECK: node .unlazy/verify.cjs checks
  EXPECT: checks verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=0c8ed0fa1d9e2ed746a23e6950558e342c8282f025bf826da67f7d29768a30ac; exit=0; EXPECT=matched; output-sha256=1c17db53ee1307bf93aa0a078bd209c7e9aa1e8f0fe3f4c769c63214b84b3f9b; output-bytes=16; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries

- [x] G7: Dispatched branch browser smoke passes on production as QA on desktop and mobile without running board-writing jobs
  CHECK: node .unlazy/verify.cjs smoke
  EXPECT: smoke verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=c5a5d356ba5d0fae40bf87d1155379eba78886b0af58f15d15f3397fe82f5dee; exit=0; EXPECT=matched; output-sha256=344f6074480cdfdc6b78a3e3942701e296a66b0d74127c4dad952f09f3a3600f; output-bytes=15; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries

- [x] G8: Final audit confirms the PR remains unmerged and evidence is available to the owning runner
  CHECK: node .unlazy/verify.cjs final
  EXPECT: final verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=278a3ace0209ea4259dc40aad6516924ec8c0a6734a88bae3fa05c9c48b8d721; exit=0; EXPECT=matched; output-sha256=121e4e6bab4f29ad289643247a9513721efb6ee18049f6f87ab4e584c8a9ddd1; output-bytes=15; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-fixture; path=3cdbf7dc8e1b/28 entries
