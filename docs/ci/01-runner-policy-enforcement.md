## Runner policy enforcement (YPER4-844)

`PR Guards Trusted` folds runner enforcement into required `pr-title`. It installs
only the locked workflow parser and executes production code against fetched PR
Git objects, never candidate code or candidate policy. Unknown visibility,
expressions, remote reusable workflows and nonstandard public runners fail closed.
The first deployment bootstraps enforcement for subsequent PRs; it cannot protect
itself retroactively or prevent an unmerged branch job from starting.

Before runner or cost claims, run from the target repository checkout:
`NODE_PATH=.github/scripts/node-version-guard/node_modules node .github/scripts/ci-runner-policy.cjs --repo owner/name`.
It reads live GitHub visibility, trusted `docs/ci-policy.yml` and committed workflow
files. `--ref <full SHA>` selects candidate Git data; `--policy <file>` selects the
local policy. The requested repository must match checkout origin. Standard
public hosted minutes are free; private hosted minutes can be charged, and
self-hosted infrastructure still costs money. Larger hosted runners are not free.

Private hosted workflows require `runner_policy.private_hosted_approval` pointing
to an unedited GitHub issue comment on that repository from Valentin (immutable
GitHub user ID 3296316). Its entire text must be
`Approve GitHub-hosted runners for owner/name with workflow digest <digest>.`
The refusal prints the digest. Approval stops matching when workflow content or
paths change. No other administrator can approve. Public app runner policy has
no approval override. Results log the workflow digest and approval identity/link;
API errors refuse verification. This command reads credentials through `gh`
without printing them and performs no GitHub writes.
