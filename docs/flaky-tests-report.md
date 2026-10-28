# Flaky tests

Window: workflow runs created 2026-10-10 through 2026-10-24, workflow ci-tests.yml.
Runs scanned: 3018.
Runs with more than one attempt: 138.
Same-SHA ci-tests jobs that failed and later passed: 34.
Jobs in that set whose log names a failing test: 7.

A same-SHA fail-then-pass counts only when the ci-tests job itself failed and a later attempt (or another run of that SHA) of the ci-tests job passed.
Cancelled workflows and browser-smoke-only failures are not in that count.
A row below is a test flake only when the failed job log contains a TAP `not ok <n> - <name>` line or a spec-reporter `✖ <name> (…ms)` line from the test step.
GitHub installation rate-limit reds and next/font Google fetch failures (visual-regression and the browser-smoke build, src/app/login/LoginComponent.tsx) are infra. They are tracked in https://app.hypertask.ai/detail/project-4060/678 and noted on https://app.hypertask.ai/detail/project-4060/668. They are not test flakes and are excluded from the failing-test job count and from the proven, same-SHA test, and same-code sections.
Rate limit, cancel, runner-shutdown, and font-fetch failures stay in the non-test table with the log line that classified them.
Quarantine is only for a flake whose cause is not yet found. A known cause is fixed and left off the quarantine list.
The timer report order row is that case. Its fixture rows use fixed startedAt values, and listReport breaks equal startedAt by id, so it is not quarantined.
A different SHA is counted only as a same-code flake: the ci-tests or browser-smoke job passed on that SHA, and the diff touches neither src/, e2e/, nor the failing test file.

Chat startup is fixed in https://app.hypertask.ai/detail/project-15/8038.
The resolved scope entry is removed below.
Historical log-parser regression fixtures remain.

## Proven flaky tests (1)

### tests/htpr-7146-agent-scope-routes.test.cjs › MCP timer running/report and team presence forward the authenticated agent to real services

Distinct SHAs: 2. Failing attempts: 2.

Log line:

```
actual: [ 'other-4060', 'other-15' ], expected: [ 'other-15', 'other-4060' ]
```
- `af5caea7c2e74ab6ddd09b2295c3e627421b1ea1` failed https://github.com/hypertask-ai/hypertask/actions/runs/39688934407/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39688934407/attempts/2
- `fc5dc6558c09be8c23d0146597e7134a5bc61895` failed https://github.com/hypertask-ai/hypertask/actions/runs/39535056123/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39535056123/attempts/2

## Test failures that also passed on the same SHA (7)

### tests/htpr-7146-agent-scope-routes.test.cjs › MCP timer running/report and team presence forward the authenticated agent to real services

Distinct SHAs: 2. Failing attempts: 2.

Log line:

```
actual: [ 'other-4060', 'other-15' ], expected: [ 'other-15', 'other-4060' ]
```
- `af5caea7c2e74ab6ddd09b2295c3e627421b1ea1` failed https://github.com/hypertask-ai/hypertask/actions/runs/39688934407/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39688934407/attempts/2
- `fc5dc6558c09be8c23d0146597e7134a5bc61895` failed https://github.com/hypertask-ai/hypertask/actions/runs/39535056123/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39535056123/attempts/2

### e2e/smoke/agent-sidebar-chats.spec.ts › conversation rows contain two-line titles without overlap on desktop and phone

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
e2e/smoke/agent-sidebar-chats.spec.ts › conversation rows contain two-line titles without overlap on desktop and phone
```
- `95579cc91f3d1657d240e69a8e697acbf337c2e4` failed https://github.com/hypertask-ai/hypertask/actions/runs/40112713116/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40112713116/attempts/2

### e2e/smoke/agent-sidebar-chats.spec.ts › phone conversation list leaves the composer clear and typing taps never switch chats

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
e2e/smoke/agent-sidebar-chats.spec.ts › phone conversation list leaves the composer clear and typing taps never switch chats
```
- `95579cc91f3d1657d240e69a8e697acbf337c2e4` failed https://github.com/hypertask-ai/hypertask/actions/runs/40112713116/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40112713116/attempts/2

### tests/first-agent-task-email.test.cjs › email models stay unchanged and flag defaults to Owner + QA

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/first-agent-task-email.test.cjs › email models stay unchanged and flag defaults to Owner + QA
```
- `de0331b7883435e495bbf26bfff813763d57e374` failed https://github.com/hypertask-ai/hypertask/actions/runs/38222230440/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38203312961

### tests/htpr-7146-agent-board-scope.test.cjs › presence service hides denied-board sessions and lease titles, including removed and zero grants

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
actual: [ 'Task 4060', 'Task 15' ], expected: [ 'Task 15', 'Task 4060' ]
```
- `4b589afa7878fedbc5c47586e9b1d9fa030ccfb0` failed https://github.com/hypertask-ai/hypertask/actions/runs/39961653859/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39961653859/attempts/2

### tests/htpr-7182-inbox-removed-member-postgres.test.cjs › removed member cannot read private board tasks, comments, or blocked items through old inbox notifications

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/htpr-7182-inbox-removed-member-postgres.test.cjs › removed member cannot read private board tasks, comments, or blocked items through old inbox notifications
```
- `4971c7745bbac158d0804f5118c9e61b0f6db25f` failed https://github.com/hypertask-ai/hypertask/actions/runs/38606339005/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38606339005/attempts/2

### tests/mcp-transports.test.ts › actual routes preserve legacy SSE across instances and support MCP 2 streamable HTTP

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/mcp-transports.test.ts › actual routes preserve legacy SSE across instances and support MCP 2 streamable HTTP
```
- `3d6e341138014f07635813ec4b625851c4a5e4ef` failed https://github.com/hypertask-ai/hypertask/actions/runs/38015139209/attempts/1 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38015139209/attempts/2

## Same-code flakes across SHAs (88)

These failed on one SHA and passed on another SHA whose diff does not change app code or the failing test. They are not quarantined unless the same SHA itself failed and later passed at least twice.

### e2e/smoke/agent-sidebar-chats.spec.ts › open error retries the same selected agent; outside click and native transport preserve the board

Distinct SHAs: 4. Failing attempts: 4.

Log line:

```
e2e/smoke/agent-sidebar-chats.spec.ts › open error retries the same selected agent; outside click and native transport preserve the board
```
- `222fa54f07985fc5944614ab598faa1a90523e84` failed https://github.com/hypertask-ai/hypertask/actions/runs/40057751177/job/120764651227 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40059249760/job/120769180469
- `2d2d1f1ab648914a185c787e89b1116c1101c9c6` failed https://github.com/hypertask-ai/hypertask/actions/runs/40052482220/job/120747986185 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40056610664/job/120767334219
- `73c3460c43e4b9aa4077a98e1a693fd71c97e2e1` failed https://github.com/hypertask-ai/hypertask/actions/runs/40113928036/job/120937126132 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40106227791/job/120908364587
- `91d695fc5dcb407be70653242f13275f063fd005` failed https://github.com/hypertask-ai/hypertask/actions/runs/40038897365/job/120705526803 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40033039621/job/120694515383

### tests/helpers/htpr-6992-pins.cjs › /home/runner/work/hypertask/hypertask/tests/helpers/htpr-6992-pins.cjs

Distinct SHAs: 4. Failing attempts: 4.

Log line:

```
tests/helpers/htpr-6992-pins.cjs › /home/runner/work/hypertask/hypertask/tests/helpers/htpr-6992-pins.cjs
```
- `0098cb84dfe3dc89e93831bdaf82a5abd56dac57` failed https://github.com/hypertask-ai/hypertask/actions/runs/38629615583/job/116077764440 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38633954792/job/116092271999
- `58b0e1026ea5ef4c7f33e9ac382ee52124d86e34` failed https://github.com/hypertask-ai/hypertask/actions/runs/39948999028/job/120412481563 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39957038520/job/120434995115
- `eabd329746179cb6bedceb34b64c0525188aabd3` failed https://github.com/hypertask-ai/hypertask/actions/runs/38929009353/job/117068324215 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38931090096/job/117074961759
- `eb12ce409e09e66ce35ac2c32ae8a995d0e6ae41` failed https://github.com/hypertask-ai/hypertask/actions/runs/38971298763/job/117210038256 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38973680080/job/117217841391

### tests/htpr-6478-regressions.test.cjs › existing MCP and extracted REST operation regressions pass with their original behavioral assertions

Distinct SHAs: 4. Failing attempts: 4.

Log line:

```
tests/htpr-6478-regressions.test.cjs › existing MCP and extracted REST operation regressions pass with their original behavioral assertions
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408
- `31f9ba7068c4c6d39f1da9510a61720062307fc0` failed https://github.com/hypertask-ai/hypertask/actions/runs/39891182784/job/120211060079 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39898315279/job/120233788330
- `3ecaafb29c97d75f0eddc50c9a76757a73b61548` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180481116/job/117831968043 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39181685271/job/117835580221
- `4a76bf7bd10475162585188058fa6d63a115da0e` failed https://github.com/hypertask-ai/hypertask/actions/runs/39164380652/job/117784151339 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39166199300/job/117789531459

### tests/htpr-7324-plan-ai-caps.test.cjs › tests/htpr-7324-plan-ai-caps.test.cjs

Distinct SHAs: 4. Failing attempts: 4.

Log line:

```
tests/htpr-7324-plan-ai-caps.test.cjs › tests/htpr-7324-plan-ai-caps.test.cjs
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `2fbcb4effe8ce124ac7ab934b86f535a431b45e9` failed https://github.com/hypertask-ai/hypertask/actions/runs/40054235946/job/120753535214 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### e2e/smoke/inbox-cycle.spec.ts › inbox cycle: open by click, send a comment, J and E all stay in the inbox flow

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
e2e/smoke/inbox-cycle.spec.ts › inbox cycle: open by click, send a comment, J and E all stay in the inbox flow
```
- `06f8e43489d33fdf637b7a0dc25339109b557905` failed https://github.com/hypertask-ai/hypertask/actions/runs/40042620092/job/120716962880 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40033039621/job/120694515383
- `7343973ac04b5500d6f6b4b1a716feec2601f1a5` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026559732/job/120664108009 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40033039621/job/120694515383
- `9993807d051d370259c37eae1c30fe5faabd71fa` failed https://github.com/hypertask-ai/hypertask/actions/runs/40002678152/job/120582553840 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40009068324/job/120604431124

### e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget
```
- `4eb7f65df64ce68ec015b57ecd13d1133daf1eee` failed https://github.com/hypertask-ai/hypertask/actions/runs/39476226814/job/118812770903 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39498358509/job/118907809865
- `a5610512f7cec06b990f97b8e02a045f96c658df` failed https://github.com/hypertask-ai/hypertask/actions/runs/39804707060/job/119914692175 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39807958349/job/119926140075
- `dd1b8b417b73ed15f230c4810dea4e3b0dc9583e` failed https://github.com/hypertask-ai/hypertask/actions/runs/39438057944/job/118680263872 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39442173080/job/118694584599

### tests/htpr-7312-ctrlj-skills.test.cjs › Ctrl+J skill body and precedence reach the model prompt (structured=false, cache=false)

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7312-ctrlj-skills.test.cjs › Ctrl+J skill body and precedence reach the model prompt (structured=false, cache=false)
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7312-ctrlj-skills.test.cjs › Ctrl+J skill body and precedence reach the model prompt (structured=false, cache=true)

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7312-ctrlj-skills.test.cjs › Ctrl+J skill body and precedence reach the model prompt (structured=false, cache=true)
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7312-ctrlj-skills.test.cjs › Ctrl+J skill body and precedence reach the model prompt (structured=true, cache=false)

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7312-ctrlj-skills.test.cjs › Ctrl+J skill body and precedence reach the model prompt (structured=true, cache=false)
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7312-ctrlj-skills.test.cjs › Ctrl+J skill body and precedence reach the model prompt (structured=true, cache=true)

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7312-ctrlj-skills.test.cjs › Ctrl+J skill body and precedence reach the model prompt (structured=true, cache=true)
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7319-skill-chat-followup.test.cjs › JSON and HTML writer headers round-trip Unicode identities, never bodies or create payload metadata

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7319-skill-chat-followup.test.cjs › JSON and HTML writer headers round-trip Unicode identities, never bodies or create payload metadata
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7319-skill-chat-followup.test.cjs › writer headers preserve every resolved skill in order on both response branches

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7319-skill-chat-followup.test.cjs › writer headers preserve every resolved skill in order on both response branches
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7319-skill-chat-followup.test.cjs › writer metadata omits flag-off, non-opted-in, unknown and oversized skills; malformed headers degrade safely

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7319-skill-chat-followup.test.cjs › writer metadata omits flag-off, non-opted-in, unknown and oversized skills; malformed headers degrade safely
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › authorization precedes instruction and field loading, with an own-board positive control

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › authorization precedes instruction and field loading, with an own-board positive control
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › chat: a board without custom fields gets no field block or save

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › chat: a board without custom fields gets no field block or save
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › chat: invalid Number and foreign or unknown fields are ignored without failing creation

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › chat: invalid Number and foreign or unknown fields are ignored without failing creation
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › chat: vocabulary includes the board Number definition and saves model customFields=19

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › chat: vocabulary includes the board Number definition and saves model customFields=19
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › CLI/MCP returns validated customFields without leaking its metadata into HTML

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › CLI/MCP returns validated customFields without leaking its metadata into HTML
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › compose save revalidates caller fields against only the authorized board, and server flag off refuses fields

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › compose save revalidates caller fields against only the authorized board, and server flag off refuses fields
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › compose without a field marker saves the same description as flag off

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › compose without a field marker saves the same description as flag off
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › compose: a board without custom fields gets no field block or save

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › compose: a board without custom fields gets no field block or save
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › compose: invalid Number and foreign or unknown fields are ignored without failing creation

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › compose: invalid Number and foreign or unknown fields are ignored without failing creation
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › compose: vocabulary includes the board Number definition and saves model customFields=19

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › compose: vocabulary includes the board Number definition and saves model customFields=19
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › flag off: exact production SDK prompts, no instruction/field load or save (web=false)

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › flag off: exact production SDK prompts, no instruction/field load or save (web=false)
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › flag off: exact production SDK prompts, no instruction/field load or save (web=true)

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › flag off: exact production SDK prompts, no instruction/field load or save (web=true)
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › persisted instructions reach the actual SDK prompt for chat and empty-client compose; explicit text wins

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › persisted instructions reach the actual SDK prompt for chat and empty-client compose; explicit text wins
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › recurring skeleton and title pattern outrank brevity only with the flag (web=false)

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › recurring skeleton and title pattern outrank brevity only with the flag (web=false)
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › recurring skeleton and title pattern outrank brevity only with the flag (web=true)

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › recurring skeleton and title pattern outrank brevity only with the flag (web=true)
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7471-writer-board-format.test.cjs › structured compose carries each task's own validated fields through the real SDK and save route

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7471-writer-board-format.test.cjs › structured compose carries each task's own validated fields through the real SDK and save route
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › chat: explicit labels win over writer labels

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › chat: explicit labels win over writer labels
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › chat: flag off keeps old label behavior including explicit choices

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › chat: flag off keeps old label behavior including explicit choices
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › chat: Multiprompt project label survives the real writer and save path

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › chat: Multiprompt project label survives the real writer and save path
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › chat: unclear project never falls back to the first label

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › chat: unclear project never falls back to the first label
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › chat: unknown, foreign ids, invented names and duplicates are ignored

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › chat: unknown, foreign ids, invented names and duplicates are ignored
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › chat: Wazig project label survives the real writer and save path

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › chat: Wazig project label survives the real writer and save path
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › compose save validates untrusted writer ids on the server and respects its own flag

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › compose save validates untrusted writer ids on the server and respects its own flag
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › compose: explicit labels win over writer labels

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › compose: explicit labels win over writer labels
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › compose: flag off keeps old label behavior including explicit choices

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › compose: flag off keeps old label behavior including explicit choices
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › compose: Multiprompt project label survives the real writer and save path

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › compose: Multiprompt project label survives the real writer and save path
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › compose: unclear project never falls back to the first label

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › compose: unclear project never falls back to the first label
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › compose: unknown, foreign ids, invented names and duplicates are ignored

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › compose: unknown, foreign ids, invented names and duplicates are ignored
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › compose: Wazig project label survives the real writer and save path

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › compose: Wazig project label survives the real writer and save path
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › filling an empty Ctrl+J task saves writer labels but keeps existing user labels

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › filling an empty Ctrl+J task saves writer labels but keeps existing user labels
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › MCP drafts expose only validated ids; flag off leaves the old response

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › MCP drafts expose only validated ids; flag off leaves the old response
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › split JSON: Multiprompt and Wazig tickets keep their own validated labels

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › split JSON: Multiprompt and Wazig tickets keep their own validated labels
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7513-writer-project-labels.test.cjs › split JSON: view-default tags win for every ticket; flag off ignores writer ids

Distinct SHAs: 3. Failing attempts: 3.

Log line:

```
tests/htpr-7513-writer-project-labels.test.cjs › split JSON: view-default tags win for every ticket; flag off ignores writer ids
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### archived task lists sort missing update timestamps after recent tasks

Distinct SHAs: 2. Failing attempts: 2.

Log line:

```
archived task lists sort missing update timestamps after recent tasks
```
- `3ecaafb29c97d75f0eddc50c9a76757a73b61548` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180481116/job/117831968043 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39181685271/job/117835580221
- `4a76bf7bd10475162585188058fa6d63a115da0e` failed https://github.com/hypertask-ai/hypertask/actions/runs/39164380652/job/117784151339 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39166199300/job/117789531459

### e2e/smoke/agent-sidebar-chats.spec.ts › switching chats does not move the ticket, its comments or its comment composer

Distinct SHAs: 2. Failing attempts: 2.

Log line:

```
e2e/smoke/agent-sidebar-chats.spec.ts › switching chats does not move the ticket, its comments or its comment composer
```
- `a4a71414296bd3c928084685e0a54a491e419fbe` failed https://github.com/hypertask-ai/hypertask/actions/runs/39923211228/job/120313591692 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39925362261/job/120320289637
- `eb3a68f27fa9c139b8c4b4c46bd46e30d913fdd9` failed https://github.com/hypertask-ai/hypertask/actions/runs/40048813214/job/120736587511 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40056610664/job/120767334219

### tests/htpr-7634-openai-only-default.test.cjs › app: BYOK OpenAI-only team keeps Haiku on the shared allowance, flag on or off

Distinct SHAs: 2. Failing attempts: 2.

Log line:

```
tests/htpr-7634-openai-only-default.test.cjs › app: BYOK OpenAI-only team keeps Haiku on the shared allowance, flag on or off
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7634-openai-only-default.test.cjs › mcp: BYOK OpenAI-only team keeps Haiku on the shared allowance, flag on or off

Distinct SHAs: 2. Failing attempts: 2.

Log line:

```
tests/htpr-7634-openai-only-default.test.cjs › mcp: BYOK OpenAI-only team keeps Haiku on the shared allowance, flag on or off
```
- `234b8566110e95dd6c8e7efb4ac11ce06583b461` failed https://github.com/hypertask-ai/hypertask/actions/runs/40026497454/job/120663903541 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104
- `92a1b9fa556af6fe66247fc5ae8527c53641f511` failed https://github.com/hypertask-ai/hypertask/actions/runs/40021436618/job/120646697104 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### 09:58 regression: paid team without a provisioned key fails identically before inference on MCP and web

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
09:58 regression: paid team without a provisioned key fails identically before inference on MCP and web
```
- `31f9ba7068c4c6d39f1da9510a61720062307fc0` failed https://github.com/hypertask-ai/hypertask/actions/runs/39891182784/job/120211060079 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39898315279/job/120233788330

### agent-bound MCP requests return the same missing-key access error without filing production errors

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
agent-bound MCP requests return the same missing-key access error without filing production errors
```
- `31f9ba7068c4c6d39f1da9510a61720062307fc0` failed https://github.com/hypertask-ai/hypertask/actions/runs/39891182784/job/120211060079 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39898315279/job/120233788330

### AI chat rename calls the shared UI controller for a human

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
AI chat rename calls the shared UI controller for a human
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408

### AI chat rename calls the shared UI controller for an agent

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
AI chat rename calls the shared UI controller for an agent
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408

### AI chat returns the shared readable permission denial without mutation

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
AI chat returns the shared readable permission denial without mutation
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408

### all CI directories and CI Compose files use our GHCR images

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
all CI directories and CI Compose files use our GHCR images
```
- `547c034f55038d477582045340e9d7a4b31eca59` failed https://github.com/hypertask-ai/hypertask/actions/runs/38205043879/job/114666557316 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38207184953/job/114673154589

### e2e/smoke/agent-sidebar-chats.spec.ts › amoled: anchored switch, real polling round trip, independent drafts/history and shell

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
e2e/smoke/agent-sidebar-chats.spec.ts › amoled: anchored switch, real polling round trip, independent drafts/history and shell
```
- `a5578a0462f21ae0cae22b4624b0e5dcca12b2b6` failed https://github.com/hypertask-ai/hypertask/actions/runs/39901257404/job/120243508547 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39903148505/job/120249006853

### e2e/smoke/agent-sidebar-chats.spec.ts › dia: anchored switch, real polling round trip, independent drafts/history and shell

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
e2e/smoke/agent-sidebar-chats.spec.ts › dia: anchored switch, real polling round trip, independent drafts/history and shell
```
- `1ce39ff07b78bb7a4b1ca578d84bbe6a2c704df4` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037741856/job/120701249827 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40040629475/job/120717787627

### e2e/smoke/agent-sidebar-chats.spec.ts › past chats are listed newest first above agents and reopen

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
e2e/smoke/agent-sidebar-chats.spec.ts › past chats are listed newest first above agents and reopen
```
- `3f112e7462f6ba90b2a074fd6565398ef4d6b8aa` failed https://github.com/hypertask-ai/hypertask/actions/runs/40041491388/job/120713757042 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40039154103/job/120705856796

### e2e/smoke/layout-lock-matrix.spec.ts › layout lock matrix: inbox

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
e2e/smoke/layout-lock-matrix.spec.ts › layout lock matrix: inbox
```
- `0c62f16125dbf93d90f3145b39d773146c94e0a2` failed https://github.com/hypertask-ai/hypertask/actions/runs/38434846135/job/115426048580 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38447609740/job/115470695014

### e2e/smoke/layout-lock.spec.ts › layout baseline: inbox

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
e2e/smoke/layout-lock.spec.ts › layout baseline: inbox
```
- `0c62f16125dbf93d90f3145b39d773146c94e0a2` failed https://github.com/hypertask-ai/hypertask/actions/runs/38434846135/job/115426048580 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38447609740/job/115470695014

### MCP and AI tool inputs trim titles and reject empty or overlong titles before mutation

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
MCP and AI tool inputs trim titles and reject empty or overlong titles before mutation
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408

### MCP managed-agent rename reaches the shared controller with its agent scope

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
MCP managed-agent rename reaches the shared controller with its agent scope
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408

### MCP tool passes through the shared permission failure and never writes

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
MCP tool passes through the shared permission failure and never writes
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408

### MCP tool sends the CLI-compatible PATCH and reaches the UI controller

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
MCP tool sends the CLI-compatible PATCH and reaches the UI controller
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408

### paid teams still resolve their managed gateway or direct BYOK key, never the shared pool

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
paid teams still resolve their managed gateway or direct BYOK key, never the shared pool
```
- `31f9ba7068c4c6d39f1da9510a61720062307fc0` failed https://github.com/hypertask-ai/hypertask/actions/runs/39891182784/job/120211060079 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39898315279/job/120233788330

### rename_board is present in MCP registry, metadata and deferred catalog

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
rename_board is present in MCP registry, metadata and deferred catalog
```
- `1c2e437f13dea19a8b902e3d9b5c9aff4f8879f5` failed https://github.com/hypertask-ai/hypertask/actions/runs/39180885241/job/117833178868 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39182841467/job/117839086408

### tests/activation-wiring.test.ts › a delegated managed agent completion belongs to the board owner, not the token owner

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/activation-wiring.test.ts › a delegated managed agent completion belongs to the board owner, not the token owner
```
- `eb3a68f27fa9c139b8c4b4c46bd46e30d913fdd9` failed https://github.com/hypertask-ai/hypertask/actions/runs/40048813214/job/120736587769 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40056610664/job/120767335686

### tests/activation-wiring.test.ts › adopting guest boards emits once for the new owner; repeat adoption is ignored

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/activation-wiring.test.ts › adopting guest boards emits once for the new owner; repeat adoption is ignored
```
- `7079f3ec70d389a2c81fd69123cc6d6db27a1a6a` failed https://github.com/hypertask-ai/hypertask/actions/runs/38357972057/job/115165632585 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38361115804/job/115175283587

### tests/activation-wiring.test.ts › managed agent completion passes through the task controller and repeat updates do not emit

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/activation-wiring.test.ts › managed agent completion passes through the task controller and repeat updates do not emit
```
- `eb3a68f27fa9c139b8c4b4c46bd46e30d913fdd9` failed https://github.com/hypertask-ai/hypertask/actions/runs/40048813214/job/120736587769 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40056610664/job/120767335686

### tests/activation-wiring.test.ts › manual board controller captures after persisted creation

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/activation-wiring.test.ts › manual board controller captures after persisted creation
```
- `eb3a68f27fa9c139b8c4b4c46bd46e30d913fdd9` failed https://github.com/hypertask-ai/hypertask/actions/runs/40048813214/job/120736587769 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40056610664/job/120767335686

### tests/activation-wiring.test.ts › seeded onboarding board emits seeded source from its creation controller

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/activation-wiring.test.ts › seeded onboarding board emits seeded source from its creation controller
```
- `eb3a68f27fa9c139b8c4b4c46bd46e30d913fdd9` failed https://github.com/hypertask-ai/hypertask/actions/runs/40048813214/job/120736587769 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40056610664/job/120767335686

### tests/board-filters/saved-views.test.cjs › MCP timer running/report and team presence forward the authenticated agent to real services

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/board-filters/saved-views.test.cjs › MCP timer running/report and team presence forward the authenticated agent to real services
```
- `fa228ab95fade8dd3bbcb70b39841e80a7414d2e` failed https://github.com/hypertask-ai/hypertask/actions/runs/40114868851/job/120933968265 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40112766265/job/120927753790

### tests/board-filters/saved-views.test.cjs › pull requests can read but cannot publish dependency caches

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/board-filters/saved-views.test.cjs › pull requests can read but cannot publish dependency caches
```
- `fac34309a32e8b87c85df5158feefdc064ecf187` failed https://github.com/hypertask-ai/hypertask/actions/runs/40093401216/job/120870904490 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40095070766/job/120875482086

### tests/ci-dependency-cache.test.cjs › pull requests can read but cannot publish dependency caches

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/ci-dependency-cache.test.cjs › pull requests can read but cannot publish dependency caches
```
- `fac34309a32e8b87c85df5158feefdc064ecf187` failed https://github.com/hypertask-ai/hypertask/actions/runs/40093401216/job/120870904490 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40095070766/job/120875482086

### tests/ci-images.test.cjs › every CI service and command-line consumer uses a pinned GHCR copy with read-only authentication

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/ci-images.test.cjs › every CI service and command-line consumer uses a pinned GHCR copy with read-only authentication
```
- `57285ea1fded22019c73a720c09a38af3cf7708b` failed https://github.com/hypertask-ai/hypertask/actions/runs/38205788009/job/114668871108 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38207184953/job/114673154589

### tests/htpr-6509-s3-contracts.test.cjs › guest board cascade guest_fixture/false: safety guard and ordered deletes are identical

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/htpr-6509-s3-contracts.test.cjs › guest board cascade guest_fixture/false: safety guard and ordered deletes are identical
```
- `89f812cd43f2686a3f12cbd751fd336659f04218` failed https://github.com/hypertask-ai/hypertask/actions/runs/38550826554/job/115808073289 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38552309477/job/115812954987

### tests/htpr-7146-agent-scope-routes.test.cjs › MCP timer running/report and team presence forward the authenticated agent to real services

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
actual: [ 4060, 15 ], expected: [ 15, 4060 ]
```
- `fa228ab95fade8dd3bbcb70b39841e80a7414d2e` failed https://github.com/hypertask-ai/hypertask/actions/runs/40114868851/job/120933968265 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40112766265/job/120927753790

### tests/htpr-7634-openai-only-default.test.cjs › conversation titles never apply the OpenAI-only default, so a supplied gateway key never runs Luna

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/htpr-7634-openai-only-default.test.cjs › conversation titles never apply the OpenAI-only default, so a supplied gateway key never runs Luna
```
- `29f9ffb966280832438d1cbbd2f3771f812af6b0` failed https://github.com/hypertask-ai/hypertask/actions/runs/40037597053/job/120700774995 then passed https://github.com/hypertask-ai/hypertask/actions/runs/39361312206/job/118427905104

### tests/htpr-7652-ctrlj-enter-queue.test.cjs › flag off keeps the old behaviour where Enter during the board load does nothing

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/htpr-7652-ctrlj-enter-queue.test.cjs › flag off keeps the old behaviour where Enter during the board load does nothing
```
- `08dc76d20d922fefd4b5be9034035cf2296bfb16` failed https://github.com/hypertask-ai/hypertask/actions/runs/40114663484/job/120933359178 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40112875458/job/120928073211

### tests/kanban-task-project-consistency.test.cjs › HTPR-6196: task cards use the project from their rendered board snapshot

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/kanban-task-project-consistency.test.cjs › HTPR-6196: task cards use the project from their rendered board snapshot
```
- `3f112e7462f6ba90b2a074fd6565398ef4d6b8aa` failed https://github.com/hypertask-ai/hypertask/actions/runs/40041491388/job/120713756941 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40035955341/job/120695343028

### tests/parity-contract.test.cjs › five-surface parity catalog has no unreviewed drift

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/parity-contract.test.cjs › five-surface parity catalog has no unreviewed drift
```
- `849eae76bf236e107bdb14b6f1f8edf65c211cee` failed https://github.com/hypertask-ai/hypertask/actions/runs/38663348041/job/116189501859 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38665851503/job/116197524582

### tests/parity-contract.test.cjs › trusted validation permits only the CLI package selected by the trusted runner

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/parity-contract.test.cjs › trusted validation permits only the CLI package selected by the trusted runner
```
- `849eae76bf236e107bdb14b6f1f8edf65c211cee` failed https://github.com/hypertask-ai/hypertask/actions/runs/38663348041/job/116189501859 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38665851503/job/116197524582

### tests/parity-contract.test.cjs › trusted validation recomputes candidate artifacts without executing candidate code

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/parity-contract.test.cjs › trusted validation recomputes candidate artifacts without executing candidate code
```
- `849eae76bf236e107bdb14b6f1f8edf65c211cee` failed https://github.com/hypertask-ai/hypertask/actions/runs/38663348041/job/116189501859 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38665851503/job/116197524582

### tests/parity-contract.test.cjs › trusted validation rejects candidate replacement of the canonical policy

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/parity-contract.test.cjs › trusted validation rejects candidate replacement of the canonical policy
```
- `849eae76bf236e107bdb14b6f1f8edf65c211cee` failed https://github.com/hypertask-ai/hypertask/actions/runs/38663348041/job/116189501859 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38665851503/job/116197524582

### tests/parity-contract.test.cjs › trusted validation rejects removals and permits only bounded concrete transitions

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/parity-contract.test.cjs › trusted validation rejects removals and permits only bounded concrete transitions
```
- `849eae76bf236e107bdb14b6f1f8edf65c211cee` failed https://github.com/hypertask-ai/hypertask/actions/runs/38663348041/job/116189501859 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38665851503/job/116197524582

### tests/posthog-error-issues.test.cjs › issue-id dedupe persists through repeated polls, releases and archived tickets

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/posthog-error-issues.test.cjs › issue-id dedupe persists through repeated polls, releases and archived tickets
```
- `61fb342528ea3e823c438c7da226eae1f1313abb` failed https://github.com/hypertask-ai/hypertask/actions/runs/38298600361/job/114975689649 then passed https://github.com/hypertask-ai/hypertask/actions/runs/38300303516/job/114981328673

### tests/pr-guards-workflow.test.cjs › PR guards share one runner, retain every verdict and never persist checkout credentials

Distinct SHAs: 1. Failing attempts: 1.

Log line:

```
tests/pr-guards-workflow.test.cjs › PR guards share one runner, retain every verdict and never persist checkout credentials
```
- `e0f2f5e870b469081baa28715e8a5f852249fc1f` failed https://github.com/hypertask-ai/hypertask/actions/runs/40115018865/job/120934407698 then passed https://github.com/hypertask-ai/hypertask/actions/runs/40111783502/job/120927993318

## Same-SHA failures that are not test flakes

### rate-limit (29)

Example log line:

```
gh: API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID 7040:96636:1F2679:6673E1:6ADB5CCA and timestamp 2026-10-23 13:10:34 UTC. For more on scraping GitHub and how it may affect your rights, please review our Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) (HTTP 403)
```

- `06d3669576db` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39958939893/attempts/1
- `0f2aace79273` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39915046396/attempts/1
- `1557a1bd4566` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40112051630/attempts/1
- `1557a1bd4566` attempt 2 https://github.com/hypertask-ai/hypertask/actions/runs/40112051630/attempts/2
- `1557a1bd4566` attempt 3 https://github.com/hypertask-ai/hypertask/actions/runs/40112051630/attempts/3
- `2c2b602bdb29` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39957465711/attempts/1
- `31721e4aa6fc` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39704355384/attempts/1
- `32b4bd14e249` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39957038520/attempts/1
- `34fd8f15e042` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39944408798/attempts/1
- `39cdd99b0192` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40111027887/attempts/1
- `3dd599d16d7f` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40106526360/attempts/1
- `3e0ebc7e675a` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40110483279/attempts/1
- `52b3f7685d4a` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39944229995/attempts/1
- `64756be3f098` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40106610667/attempts/1
- `69daad123312` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39950261268/attempts/1
- `6f28e37f3c59` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39674968759/attempts/1
- `781f9281f0ef` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39704027539/attempts/1
- `7de40c9ff39a` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39949102746/attempts/1
- `89580ee30e99` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39942841893/attempts/1
- `8c12aab047b4` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40111783502/attempts/1
- `8c3363c1702c` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39676570849/attempts/1
- `8d9a3abeb954` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40107659804/attempts/1
- `b04e17ed4015` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39675829490/attempts/1
- `b3f1dd06cf37` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40106001301/attempts/1
- `c5fb2683e408` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40110629968/attempts/1
- `caf14a26990e` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/40111039652/attempts/1
- `d62439f98bc7` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39942868069/attempts/1
- `d9c06603f2e3` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39950231101/attempts/1
- `dfd45db8e492` attempt 1 https://github.com/hypertask-ai/hypertask/actions/runs/39676506911/attempts/1

