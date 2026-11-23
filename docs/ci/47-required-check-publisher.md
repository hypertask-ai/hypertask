## Required check with no publisher (HTPR-9357)

`required-check-publishers.yml` runs hourly from `production`. It reads the active
`production-required-checks` ruleset and the newest 20 open production pull requests
that are at least 3 hours old. Only a status from the ruleset app, or a check run
from that app, counts, including a failure or a pending result. One missing set
posts one `qa` comment per UTC day on [HTPR-9357](https://app.hypertask.ai/detail/project-15/9357).
A healthy set, or no pull request old enough, posts nothing. The job does not edit
the ruleset. An unreadable GitHub response fails the run and posts nothing.
