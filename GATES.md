# Gates: YPER4-232 speed analyst

OWNS: scripts/speed/**, .claude/skills/speed-analyst/**, .claude/skills/INDEX.md, tests/speed-analyst.test.cjs

Scope: https://app.hypertask.ai/detail/project-4060/232, deliver one unmerged production PR with a safe live measurement, daily user timer, speed-only analyst loop and research playbook. No board writes or timer activation by this helper. Keep this local ledger out of the PR.

G5 oracle change, explicit: the initial local full `npm run lint` passed with 0 errors and 21 existing warnings, followed by all 14 UI-pattern tests (/tmp/yper4-232-lint.log). The final local repeat remained queued behind all three shared heavy-job slots for 15 minutes and was stopped only after final-head hosted lint passed; no guard was bypassed and no other session was stopped. Use the identical required hosted CI `Lint` step (`npm run lint` with supported content cache) bound to this final HEAD, plus an actual local UI-pattern rerun. This preserves the full lint outcome rather than substituting targeted lint; targeted lint separately passed for both changed code files.

- [x] G0: this ledger states testable acceptance outcomes
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=40d401b5554cc080c5ad75959423cfb5127d9155e22e223aaea9650cd144e05a; output-bytes=504; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-232; path=3cdbf7dc8e1b/28 entries

- [x] G1: measuring code tests prove timing statistics, seven-day comparison, safety, history and failure handling
  CHECK: node --test --test-reporter=tap tests/speed-analyst.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a61a9da1c411780d6a02b47ee51aa9f0f14f7ddb08878309fc7a2ca1e76877e3; exit=0; EXPECT=matched; output-sha256=8c0268d7993d832b30792c22fa29ec49f508931e3e3d8aa6c0e40a19ef9590e6; output-bytes=3248; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-232; path=3cdbf7dc8e1b/28 entries

- [x] G2: one real live run proves desktop and phone board, cold and warm ticket, search, My Tasks, Ctrl+J and page navigation, with production commit and complete metrics
  CHECK: node scripts/speed/measure.mjs --verify-history
  EXPECT: LIVE HISTORY VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=bb1be539848f691962b18b37ea6163e1bd8c80d769ba673e699a2a948788b767; exit=0; EXPECT=matched; output-sha256=2db4044f343bb3f87b0c6f07811080c74a0d0d7d7d20d507c65a3b3651d46ff9; output-bytes=22; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-232; path=3cdbf7dc8e1b/28 entries

- [x] G3: daily systemd service and timer validate without installation or activation
  CHECK: systemd-analyze --user verify scripts/speed/systemd/speed-measure.service scripts/speed/systemd/speed-measure.timer
  EXPECT: /^$/
  EVIDENCE: automatic-evidence=v1; definition-sha256=0c103b17793c2b98ecdd390c0a6e8772056137607f079c8301e18b2f0b152970; exit=0; EXPECT=matched; output-sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; output-bytes=0; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-232; path=3cdbf7dc8e1b/28 entries

- [x] G4: registered skill and playbook cover the speed-only loop, investigation and weekly stack research, measured historical lessons, safety and owner handoff
  EVIDENCE: Reread .claude/skills/INDEX.md:22, speed-analyst/SKILL.md:8-35 and PLAYBOOK.md:5-73 at 3d00fa986d02472f4c8e9432e23ce106bb4a12ce. Short skill maps daily report, high-reasoning deep trace/network/bundle/server/query investigation, deduplicated one-ticket speed-only /ship fixes, same-condition proof, learning, weekly open-ended scored stack research and owner-only vcc. Playbook cites merged PR bodies, false leads/reverts and explicitly unproven ms, installed lockfile versions, proposed new probes and research experiments; no invented before/after savings or completed-research claims.

- [x] G5: repository lint and UI pattern checks pass
  CHECK: test "$(gh api repos/hypertask-ai/hypertask/actions/runs/38001866125 --jq .head_sha)" = "$(git rev-parse HEAD)" && test "$(gh api repos/hypertask-ai/hypertask/actions/runs/38001866125/jobs --jq '.jobs[] | select(.name == "ci-tests") | .steps[] | select(.name == "Lint") | .conclusion')" = success && node --test --test-reporter=tap tests/ui-patterns.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=87254b20f13366c30a948211c3ebd54ddf3c22b901be71b796619f36b3ae8f6c; exit=0; EXPECT=matched; output-sha256=a705cabaa26f72511ab511968df610d9b5fe2eec12d44ea9638bb73dcf5bc896; output-bytes=2928; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-232; path=3cdbf7dc8e1b/28 entries

- [x] G6: a single PR targets production with the exact requested title, plain-language body and real first-run summary; no merge, board writes or enabled timer
  EVIDENCE: https://github.com/hypertask-ai/hypertask/pull/1238 is OPEN, merged=false, auto_merge=null, base=production and HEAD=3d00fa986d02472f4c8e9432e23ce106bb4a12ce (approved GitHub API read saved /tmp/yper4-232-final-pr.json). Exact requested title; body starts Summary for non-engineers and Read the daily speed report, required four sections, numbered changes, no em dash, requested footer. Successful 2026-10-09T22:53:07.138Z live output copied from /tmp/yper4-232-first-measure.log; unchanged production 8e22b4e1d55d210d08fe3ab0e296373826bc4253, QA 2343, Node v24.19.0, 14 cohorts, N=1, high host load and no baseline caveats. systemctl --user is-enabled speed-measure.timer returned not-found. No vcc, timer installation/activation or merge executed; owner handoff documented scripts/speed/README.md:42-63.

- [x] G7: required PR checks settle, and AI review major findings are repaired for up to two rounds or explicitly handed off
  EVIDENCE: Final-head gh pr checks --watch exited 0 (/tmp/yper4-232-final-checks.log). CI run https://github.com/hypertask-ai/hypertask/actions/runs/38001866125 passed ci-tests (13m52s, including full Lint) and browser-smoke (7m9s). app-smoke passed real build and eight core actions. All required checks green at 3d00fa986d02472f4c8e9432e23ce106bb4a12ce, including both AI-review contexts, feature-flag-gate, premerge-evidence, title and security. Initial AI review had only two MINORs, both fixed and regression-covered; final AI review https://github.com/hypertask-ai/reviewer/actions/runs/38001661968 reports APPROVE with no findings. No MAJOR repair round needed. Superseded same-head CI canceled by PR-body edit is not the final run; no check bypass or merge.

- [x] G8: final reread confirms every requested deliverable, no credentials or trace payloads committed, and all claimed numbers match the private history
  EVIDENCE: Final diff is 8 intended files, 740 lines, no app/UI/dependency/workflow change and only untracked GATES.md locally. Reviewed all script, tests, skill, playbook, registration and units at 3d00fa986d02472f4c8e9432e23ce106bb4a12ce; git diff --check passed. Private ~/.local/state/speed/history.json is outside Git and retains all failed runs unchanged. Latest live run has status complete and all 14 printed cohorts match PR using Math.round semantics; --verify-history passes. Only whitelisted numeric/request-path/Server-Timing-name metrics persist, no headers, bodies, credentials or storage state. Final-head GitHub secret scans passed. Units supplied but not installed; no autonomous LLM daemon or weekly scheduler requested/built, weekly learning stays with the owning analyst session.
