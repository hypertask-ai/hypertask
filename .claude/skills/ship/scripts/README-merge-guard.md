# gh merge guard handoff

This changes the shared `gh` execution boundary. Independent review and hosted regression checks are required before installation. Do not install from an unreviewed checkout.

After approval, from the reviewed production checkout, run:

```sh
python3 .claude/skills/ship/scripts/gh-merge-guard --install
```

The installer updates the current user's `~/.local/bin/gh` and installs the guard, `ship-check`, and its parser under `~/.local/lib/hypertask/merge-guard`. Repeat after approved updates to those files. The installer rejects an unfamiliar wrapper rather than rewriting it. Review wrapper changes before retrying. Confirm the installed wrapper, hosted checks, and actual merge refusal before release handoff; do not perform a real merge as a test.

The guard accepts numbered PRs and GitHub PR URLs, including repository flags before or after `pr merge`. Unsupported merge or parent options are refused. Known built-in commands and ordinary reads pass through to the real binary; native aliases and unrecognized top-level commands are unsupported and refused. Extensions are outside this guarantee. If the guard itself is missing, the wrapper refuses every command until restored. A missing or failing checker refuses merges.

Merges require an explicit target from a PR URL, repository flag, or `GH_REPO`. Implicit GitHub CLI repository selection is refused. `SHIP_REPO` opts foreign repositories into checks, but never selects the destination. App merges always use the production base. Direct API merges and use of another executable are outside this boundary; this is not a security boundary against malicious executables.

A merge is also refused when the pull request head is behind the base branch (HYCI-262). The refusal names how far behind it is and the `update-branch` call to run; the branch is updated and checks rerun before the merge is attempted again. `ship-check fresh <pr>` runs that check alone. The base tip is read again after the premerge status publication, so a base move during that wait cannot slip past it. `--auto` is refused outright: a delayed merge can land after the base moves, and nothing would then recheck it.

The wrapper hands the whole command to the guard, which holds an exclusive per-repository merge lock from the freshness read until the merge exits. Two guarded merges therefore cannot interleave: the second waits for the first to finish, then reads the moved base and refuses if it is behind. The wait stops after ten minutes with a refusal naming the lock. Pass-through commands take no lock. A merge made outside this wrapper, such as the web UI, a direct API call, or the repo's own automerge workflow, is still outside this boundary.

The guard also pins the merge to the head it checked (HYCI-262). It records the head sha it read on the freshness path and adds `--match-head-commit <sha>` to the real merge, so a branch pushed after that read is refused by GitHub ("Head branch was modified") instead of merging a head nobody checked. A caller-supplied `--match-head-commit` that names a different sha is refused before the merge. A Hypertask merge whose guard recorded no head is refused too, which forces a reinstall of an old guard pair rather than a silent unpinned merge.
