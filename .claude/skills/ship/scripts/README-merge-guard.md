# gh merge guard handoff

This changes the shared `gh` execution boundary. Independent review and hosted regression checks are required before installation. Do not install from an unreviewed checkout.

After approval, from the reviewed production checkout, run:

```sh
python3 .claude/skills/ship/scripts/gh-merge-guard --install
```

The installer updates the current user's `~/.local/bin/gh` and installs the guard, `ship-check`, and its parser under `~/.local/lib/hypertask/merge-guard`. Repeat after approved updates to those files. The installer rejects an unfamiliar wrapper rather than rewriting it. Review wrapper changes before retrying. Confirm the installed wrapper, hosted checks, and actual merge refusal before release handoff; do not perform a real merge as a test.

The guard accepts numbered PRs and GitHub PR URLs, including repository flags before or after `pr merge`. Unsupported merge or parent options are refused. Known built-in commands and ordinary reads pass through; native aliases and unrecognized top-level commands are unsupported and refused. Extensions are outside this guarantee. If the guard itself is missing, the wrapper refuses every command until restored. A missing or failing checker refuses merges.

Merges require an explicit target from a PR URL, repository flag, or `GH_REPO`. Implicit GitHub CLI repository selection is refused. `SHIP_REPO` opts foreign repositories into checks, but never selects the destination. App merges always use the production base. Direct API merges and use of another executable are outside this boundary; this is not a security boundary against malicious executables.

A merge is also refused when the pull request head is behind the base branch (HYCI-262). The refusal names how far behind it is and the `update-branch` call to run; the branch is updated and checks rerun before the merge is attempted again. `ship-check fresh <pr>` runs that check alone.
