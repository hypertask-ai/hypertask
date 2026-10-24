# Gates: /ship

Scope: take this session's tickets end to end, live and verified.

- [x] YPER4-651.ticket: The ticket exists on the board
  CHECK: '/home/valentin/.agents/skills/ship/scripts/ship-check' ticket YPER4-651
  EXPECT: ticket ok
  CWD: /home/valentin/projects/hypertask/.worktrees/yper4-651
  EVIDENCE: automatic-evidence=v1; definition-sha256=6d66e239be36bbf2a4f4aa667073b0ad2fc3ab26bbf93e73936986694326e9a2; exit=0; EXPECT=matched; output-sha256=8d17ceac7d82fd2d508e2c28bd2fcf6931ed2b742384e96afd5c876e7c0ad828; output-bytes=10; shell=/bin/sh; cwd=/home/valentin/projects/hypertask/.worktrees/yper4-651; path=b7c9797232e1/20 entries

- [x] YPER4-651.deeper: A Deeper: agent activity names the field, raw source, method and outside proof, and its proof gate is a runnable CHECK
  CHECK: '/home/valentin/.agents/skills/ship/scripts/ship-check' deeper YPER4-651
  EXPECT: deeper ok
  CWD: /home/valentin/projects/hypertask/.worktrees/yper4-651
  EVIDENCE: automatic-evidence=v1; definition-sha256=96bb2747bf9ce71850613d0deeb223bb44f636adebf91002c28e0a680696b3f0; exit=0; EXPECT=matched; output-sha256=6674e696cff81f5bf7a8a5f3c9e236afb4791fd65c11a54a18bcfac64933f18e; output-bytes=10; shell=/bin/sh; cwd=/home/valentin/projects/hypertask/.worktrees/yper4-651; path=b7c9797232e1/20 entries

- [x] YPER4-651.pr: The PR is named HTPR-NNNN [TYPE] description
  CHECK: '/home/valentin/.agents/skills/ship/scripts/ship-check' pr YPER4-651
  EXPECT: title ok
  CWD: /home/valentin/projects/hypertask/.worktrees/yper4-651
  EVIDENCE: automatic-evidence=v1; definition-sha256=af41b0cd32ae180d658dd5288b928d6464ea5800a6edcaa3479d87fa1ea51e4f; exit=0; EXPECT=matched; output-sha256=3e5eb25a9ae48fbbbdfa9c3628c39a4092101d39a04ff8f6479e486bbf311afd; output-bytes=79; shell=/bin/sh; cwd=/home/valentin/projects/hypertask/.worktrees/yper4-651; path=b7c9797232e1/20 entries

- [ ] YPER4-651.merged: The PR is merged into production
  CHECK: '/home/valentin/.agents/skills/ship/scripts/ship-check' merged YPER4-651
  EXPECT: merged ok
  CWD: /home/valentin/projects/hypertask/.worktrees/yper4-651
  EVIDENCE: pending

- [ ] YPER4-651.deployed: The Production deployment for the merge is success
  CHECK: '/home/valentin/.agents/skills/ship/scripts/ship-check' deployed YPER4-651
  EXPECT: deployed ok
  CWD: /home/valentin/projects/hypertask/.worktrees/yper4-651
  EVIDENCE: pending

- [x] YPER4-651.docs: Docs page change is merged and live on docs.hypertask.ai, or a No user-visible change reason is recorded
  CHECK: '/home/valentin/.agents/skills/ship/scripts/ship-check' docs YPER4-651
  EXPECT: docs ok
  CWD: /home/valentin/projects/hypertask/.worktrees/yper4-651
  EVIDENCE: automatic-evidence=v1; definition-sha256=f9e1fa99ebc6868ac3125a28d467c367420c650fe6ff450775567216dd444da1; exit=0; EXPECT=matched; output-sha256=65b1e475743166f9f0e8ebfc1adcf466b3356349017c17638b07f5b5e267f32b; output-bytes=33; shell=/bin/sh; cwd=/home/valentin/projects/hypertask/.worktrees/yper4-651; path=b7c9797232e1/20 entries

- [ ] YPER4-651.done: The ticket is in Done
  CHECK: '/home/valentin/.agents/skills/ship/scripts/ship-check' done YPER4-651
  EXPECT: done ok
  CWD: /home/valentin/projects/hypertask/.worktrees/yper4-651
  EVIDENCE: pending

- [ ] YPER4-651.cleaned: This session removed its worktree and branch for the ticket (/clean-up)
  CHECK: '/home/valentin/.agents/skills/ship/scripts/ship-check' cleaned YPER4-651
  EXPECT: cleaned ok
  CWD: /home/valentin/projects/hypertask/.worktrees/yper4-651
  EVIDENCE: pending
ABANDON: YPER4-651.merged waiting on PR 2027 CI; Claude budget hold from HT Product Lead, resumes on check result
ABANDON: YPER4-651.deployed waiting on PR 2027 CI; Claude budget hold from HT Product Lead, resumes on check result
ABANDON: YPER4-651.done waiting on PR 2027 CI; Claude budget hold from HT Product Lead, resumes on check result
ABANDON: YPER4-651.cleaned waiting on PR 2027 CI; Claude budget hold from HT Product Lead, resumes on check result
