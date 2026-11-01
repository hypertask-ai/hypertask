## Guard API budget (YPER4-721)

The scanner workflow reports GitHub-native `secret-scan` and
`next-public-secrets` jobs. It makes no commit-status API calls, including
for fork and Dependabot PRs. Both scanners remain mandatory; the public-secret
summary fails unless its scan step explicitly succeeded. One additional tiny
summary job replaces the old status publisher and trusted completion workflow.

The trusted workflow reads PR metadata once for outside, size and title
checks. It publishes only the existing required `pr-title` status, combining
outside, size and title outcomes. A size block reddens that context and sends no
extra status write. A fresh pending status
invalidates an earlier same-head success before metadata reevaluation, so an
invalid title cannot keep its prior approval during later quota retries.
Publication rereads the open PR, production base, exact head, event title,
evaluated title and evaluated labels. A rate-limit refusal
waits until the supplied reset and retries that whole fresh-read/publication
operation. Ordinary authorization errors remain failures. The retry wait is
bounded to one hour; an unavailable required result never becomes green.
No required ruleset context changes.

Trusted guard concurrency includes the workflow run ID.
Older event reruns cannot cancel newer evaluations.
Reruns still share their original event's group.

`node tests/guard-quota.test.cjs` executes the saved production scripts and
candidate workflow entry points with isolated GitHub responses. For a small,
same-repository PR without an existing size comment, the two guard workflows
use 22 explicit GitHub REST calls before and six after; writes fall from ten
to two. These are instrumented fixture counts, not network telemetry or
whole-fleet savings. Checkout, Actions internals, ticket binding, other
workflows and exceptional comment writes are excluded. The immutable fixture
records its production source SHA. Ten simulated pushes recover both a read
and publication 403 each; a real ten-push burst still requires separate logs.

App-smoke discovery uses the same reset-aware callback retry. Each replay
starts by rechecking the live head before cancelling older runs. If the retry budget is exhausted, cancellation is skipped and the build continues. This covers
the observed discovery-step refusal; the workflow's separate initial shell
lookups and final report remain separate API consumers.
