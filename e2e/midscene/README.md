# Nightly Midscene flows

[Midscene](https://github.com/web-infra-dev/midscene) and Puppeteer check the live app. The three guest-board checks and five signed-in checks run together through `nightly.sh` (the script calls `guarded-run.sh --all`). Landing and login-screen checks were removed because prod-health already owns them.

| Flow | Proof |
|---|---|
| `board-demo` | Guest board and its three columns render |
| `task-detail-demo` | A guest task detail opens |
| `task-create-demo` | A task created on the disposable guest board appears |
| `signed-in-create-task` | Create through the QA UI and reload the saved card |
| `signed-in-file-upload` | Upload a text file, save the comment, reload and download matching bytes |
| `signed-in-notification` | The normal move-to-Inbox action creates a notification that opens the QA task |
| `signed-in-reminder` | Schedule tomorrow through the UI, then verify the future reminder survives a reload |
| `signed-in-ai-answer` | A new QA chat answers a short arithmetic question, not just echoing the prompt |

Reminder delivery at the scheduled time is not covered. Notification setup uses the app's regular authenticated Inbox action, not a fabricated notification or a second person's account.

## Where nightly runs today

Checked on the VPS on 2026-10-02: **no active nightly Midscene schedule exists**. The old 03:30 VPS cron ran from `~/projects/hypertasks-qa`, which was deleted when Midscene was retired on 2026-09-15. The retirement is recorded in `.claude/skills/verify-qa/reference/midscene-flows.md`. The old `~/.cache/midscene-nightly.log` contains the missing-clone failures; the current user's crontab and systemd timers contain no Midscene entry. GitHub has no Midscene workflow. This change prepares the existing VPS entry point; it does not install or change a cron job or replace the E2B fleet.

**Release operator action, after this PR is merged:**

1. In `/home/valentin/projects/hypertask/e2e/midscene`, run `npm ci`. The maintained checkout must contain the merged production code.
2. Create `~/.config/hypertask-videos/midscene.env`, mode `0600`, using `env.example` and an approved vision-model API key. The local proof used OpenRouter's OpenAI-compatible endpoint, `google/gemini-2.5-flash`, and `MIDSCENE_MODEL_FAMILY=gemini`. Do not copy credentials into Git or logs. The retired `~/.config/val-staging/credentials.env` is not needed.
3. Keep the plain QA state at `~/.config/hypertask-videos/storageState-qa-normal.json` valid. `MIDSCENE_STORAGE_STATE` can override the path. The signed-in bootstrap must resolve to user **2343**, and that user must own an unshared board named **QA Sandbox**. Owner + QA state (985), Valentin (6), other identities, shared boards and other board names are rejected before fixture mutations.
4. Verify `vcc` is on the cron PATH and its own agent identity can read/create tickets with attachments on board 15. All automated board writes use `vcc`, never Valentin's `hypertask` credentials. Keep `systemd-run --user --scope` available.
5. Add this single line to Valentin's VPS crontab, preserving every other entry. It runs at 03:30 in the VPS's timezone and logs all flow output:

   ```cron
   30 3 * * * PATH=/home/valentin/.local/bin:/usr/local/bin:/usr/bin:/bin /home/valentin/projects/hypertask/e2e/midscene/nightly.sh >> /home/valentin/.cache/midscene-nightly.log 2>&1
   ```

**No new GitHub secret is needed for the current VPS job.** If the job is deliberately moved to GitHub later, store the *entire plain QA storage-state JSON* in secret `MIDSCENE_QA_STORAGE_STATE`, materialize it in a mode-0600 file under `RUNNER_TEMP`, and set `MIDSCENE_STORAGE_STATE` to that file. Never echo the value. Such a move also needs the model credentials, board-writer identity and equivalent resource guards; it is not configured by this PR.

## Local run and safety

```bash
cd e2e/midscene
npm ci
cp env.example .env
# Set the model credentials in the ignored .env without printing them.
npm run smoke
./guarded-run.sh --flow signed-in-reminder
npm run lint
npm run test:failure-dry-run
```

Always use `guarded-run.sh`, not `node runner.mjs` directly. It retains the single-flight `flock`, pre-run sweep, fail-closed cgroup caps (2G RAM, no swap, 1.5 CPUs, 256 tasks), ten-minute hard timeout and dedicated Chrome-profile cleanup. Nightly also holds a separate lock across execution and ticket reporting. Model family defaults to `gemini`; explicitly configure the appropriate family when changing models. Configure `MIDSCENE_OPENAI_SOCKS_PROXY` only when the selected gateway actually needs the existing tunnel; OpenRouter's direct endpoint was used for the proof.

Signed-in flows have isolated browser contexts. The upload flow blocks the buffered fallback, which has no discard grant, so a direct-upload failure cannot leave an unremovable test file. They import only app cookies, not Google cookies, MCP tokens or persisted account-switcher state. Each fixture has a run-unique title. Fixtures use authenticated product APIs, never Prisma or SQL. Cleanup runs in `finally`, on pass and failure: it rechecks private-board ownership, recovers exact-title creates, soft-deletes then permanently deletes only this run's task, clears its reminders/notifications/attachment rows, discards only its granted storage keys, removes its local upload and deletes its isolated chat. A cleanup error turns the flow red. Do not interrupt a run: a forced process kill or host crash can interrupt network cleanup. Use the exact run title/results to recover only those QA fixtures if that happens.

`@midscene/web` stays on 1.x to avoid the vulnerable `@xmldom/xmldom` dependency. Root regression tests check the dependency floor, flow registry, QA isolation, cleanup, stale results and incident deduplication.

## Results and bug tickets

Ignored `midscene_run/results-latest.json` contains `startedAt` and a result for each flow: status, failing step, error, duration, resolved URL, report and screenshot paths. `--all` continues after failures and exits nonzero when any flow fails. Screenshots are taken before cleanup. Reports stay under `midscene_run/report/`, pruned to ten recent files.

The **first red night** files a Bugs ticket on board 15 titled `Midscene nightly: <flow> failing`, with the failing step, error and screenshot attached using `vcc tasks create --attach`. Before every filing, the reporter uses the authoritative task list, not vector search, to find an exact-title open ticket, including tickets moved out of Bugs. If ticket creation succeeded but attaching its screenshot failed, the next run attaches the evidence to that same ticket instead of filing another. A passing night or lost local flake state does not permit a duplicate while that ticket is open. Done/Completed/Cancelled or archived/deleted tickets permit a new incident. Lookup failure, unknown ticket state, missing screenshot, stale results or CLI failure fail closed, without claiming successful reporting. A flow's reporting error does not suppress later incidents: the reporter attempts every flow, saves its state, then exits nonzero if any report failed.

`./nightly.sh --dry-run` still runs the real flows and QA cleanup, but only prints planned bug tickets. Dry-run state is separate from real state. `npm run test:failure-dry-run` forces an actual browser failure, verifies its PNG and failing step, then exercises the reporter twice with a simulated board: exactly one would-create and one duplicate suppression. It never invokes a board writer. Local evidence lives in `midscene_run/forced-failure-results.json` and its screenshot.

Ticket: https://app.hypertask.ai/detail/project-4060/105
