## Ticket links from PR titles

The trusted `pr-title` guard links same-repository production PRs to the ticket
in their current GitHub title through the existing MCP task-update API. It uses
`HYPERTASK_MCP_TOKEN`, not a runner-local binding file. The app checks permission,
verifies the GitHub PR and returns the saved link. The bind POST and ticket lookup
retry HTTP 500, 502, 503 and 504 up to twice, after one and two seconds. After
exhausted server errors, the guard still passes when the ticket already documents
the pull request. Missing credentials, rejected updates or an unconfirmed link fail
the guard. Forks, bot titles and generated
revert titles retain their existing handling. Ticketed runner bots also bind.
The production-only manual `pr_number` input executes the same trusted title
entry for live QA and recovery. Delayed runs can link merged PRs.
