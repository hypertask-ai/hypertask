# Gates: YPER4-312 local merge guard

OWNS: GATES.md, .claude/skills/ship/scripts/ship-check, .claude/skills/ship/scripts/ship-check.test.sh, .claude/skills/ship/scripts/fixtures/yper4-312/**, .claude/skills/ship/SKILL.md

Scope: Refuse merges with nonpassing current-head ci-tests, identify PR and production failures from genuine logs, preserve existing guards, and commit locally without board writes, push, or PR creation.

- [x] G0: The ledger has valid, meaningful outcome checks
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=f1aef2f5a96980c77a816a4a003b594bb68f33c42e5eca5744f8af22f4da215f; output-bytes=467; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-312; path=fd84e4e63686/12 entries

- [x] G1: Recorded PR failure, passing checks, latest rerun, pending checks, production comparison, API failures, missing checks, log fallback, and existing guards behave correctly
  CHECK: bash -o pipefail -c 'bash .claude/skills/ship/scripts/ship-check.test.sh | tee .ship-check-test.log'
  EXPECT: 0 failed
  EVIDENCE: automatic-evidence=v1; definition-sha256=625545b95ed64c37de1939efd3f7bddf4493eea63e2af3c61b765d33e10c1461; exit=0; EXPECT=matched; output-sha256=49d5f3bbaa5f2ac8294c89553a5f3cb364dcd00bc6f6d3747253a0bad2654066; output-bytes=35137; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-312; path=fd84e4e63686/12 entries

- [x] G2: Changed shell scripts parse and introduce no shellcheck diagnostics beyond the recorded base when shellcheck is available
  CHECK: bash -n .claude/skills/ship/scripts/ship-check .claude/skills/ship/scripts/ship-check.test.sh && if command -v shellcheck >/dev/null; then python3 -c 'import collections,json,pathlib,subprocess; files=[".claude/skills/ship/scripts/ship-check",".claude/skills/ship/scripts/ship-check.test.sh"]; lint=lambda s: collections.Counter((x["code"],x["level"],x["message"]) for x in json.loads(subprocess.run(["shellcheck","--format=json","-"],input=s,text=True,capture_output=True).stdout)); differences={f:lint(pathlib.Path(f).read_text())-lint(subprocess.check_output(["git","show","9f6b351ee1a99640d8019af30a18492c3f0c28d5:"+f],text=True)) for f in files}; print(differences); assert not any(differences.values())'; else printf 'shellcheck not installed\n'; fi && printf 'shell validation passed\n'
  EXPECT: shell validation passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=04ebd3c504d91e96dcfc6d7745efb299be9e5182b1dc0a0ce1d03fd4c87dfe3b; exit=0; EXPECT=matched; output-sha256=145a1993bcc6f1cee3321f09a661dac51ecd9b51acb8df8c3e1394b7abf6b8bc; output-bytes=139; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-312; path=fd84e4e63686/12 entries

- [x] G3: Fixtures are genuine, trimmed, secret-free recorded PR 1392 data and documentation describes the new current-head gate
  EVIDENCE: Re-fetched all three recorded check runs and both logs with gh api; every retained JSON field and log line matched. Fixtures total 75 lines and contain only public check metadata and assertion output, no environment or credentials. Two timestamp-only blank lines were omitted to avoid trailing whitespace. README records the important historical distinction: PR 1392 head ci-tests was successful, the squash run was cancelled, and completed production job 114581508375 exposed its paging assertion. Regression stub presents that genuine failed commit as a PR head. Reviewed ship-check usage and the one-sentence Hard block addition; both describe current-head CI, failure names, and production status.

- [x] G4: Only the requested worktree and surgical files changed, no new em dash, and the requested local commit has the exact subject and coauthor without board writes, push, or PR creation
  EVIDENCE: Verified cwd /home/valentin/projects/hypertask-yper4-312 and branch yper4-312-merge-guard-ci-tests. Implementation commit 73a0924b816bc7f944823b1743ec6510a55d6a19 has exactly the requested subject and final Co-Authored-By trailer. Compared all nine implementation files against original base 9f6b351ee1a99640d8019af30a18492c3f0c28d5; only owned paths changed, no added em dash, and git diff --check passes after omitting two blank fixture lines. Final full test output is 477 passed, 0 failed. Only local commits were made; no board writes, remote pushes, PR creation, stash, branch changes, or amendment. Disposable local test repositories exercise their own push fixtures as required by the existing suite. This ledger and the two-line fixture trim are recorded in a follow-up local commit with the same requested message.
