## GitHub completion notifications (YPER4-881)

`ci-wait <PR> --repo hypertask-ai/hypertask --timeout 1800` waits on local
notification files. It rereads GitHub after a notification, at most once per
minute, with a ten-minute fallback. It does not replace the release guard:
required checks still need current-head success before merging.

The runner receiver accepts `POST /github/notify` only for hook/repository pairs
listed in `~/.config/hypertask-agents/github-notify-hooks`, one
`<numeric-hook-id> <owner/repository>` pair per line. The corresponding GitHub
repository hook must deliver `workflow_run` and `pull_request` events to
`https://hooks.hypertask.ai/github/notify` using JSON and the signing secret stored
in `~/.config/hypertask-agents/github-notify-secret` (mode 0600). Never print or
commit that secret. Missing configuration refuses notifications; the waiter
continues using its fallback. Hook administration requires separate authorized
access; runner App access must not fall back to a human login.

HMAC SHA-256 is checked before parsing, state writes or GitHub lookups. Before
waking an owner, the receiver also rereads the event from GitHub. Verified
notifications are deduplicated before further lookup budget is consumed;
failed deliveries remain retryable. Hosted CI exercises unsigned refusal,
legitimate delivery, replay suppression and notification-driven waiting.

`runner-selfupdate` installs the waiter and receiver from merged production.
The lead-wake receiver wrapper loads the installed receiver module. Preserve
that wrapper and its configured lead routes during release verification.
