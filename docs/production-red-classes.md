# Production CI reds by class

_Last run: 2026-10-30. Window: 2026-10-17 to 2026-10-30, `ci-tests.yml` on `production`._

`scripts/ci-failure-census.mjs --classes` sorts every red production run by its cause, so a fix
targets the class that costs the most red hours instead of whichever red fired last.

```bash
node scripts/ci-failure-census.mjs --classes --since 2026-10-17 --branch production --out docs/production-red-classes.md
```

## Classes

Each red run takes the strongest evidence it has, first match wins.

| Class | Evidence |
| --- | --- |
| `infra` | `startup_failure` or `action_required`, or the failing log matches a shared infra rule in `scripts/flaky-log.mjs` (rate limit, runner shutdown, disk, font fetch) |
| `flaky` | the same commit was red and later green on a rerun |
| `production-only` | the merged PR's own run was green and the production run was red |
| `break` | the PR's own run was red too |

`production-only` holds what the PR never saw: a merge clash, or a check that only runs on
`production`, such as browser smoke against live flags. GitHub records alone cannot separate those
two, so the report names the failing job, step and test instead; that is what the next fix reads.

Red hours run from a red run's start until a production run concludes green, counted per class and
per UTC day. A run that went green on a retry is its own `flaky` window. Failed logs come from
`gh run view --log-failed`, parsed by the same `classifyActionsLog` the flake report uses.

ci-tests.yml on production, since 2026-10-17. 866 runs, 92 red, 14 red then green on rerun.

## Red hours lost per class

| Class | Hours | Share |
| --- | --- | --- |
| production-only | 81.7 | 76% |
| infra | 17.18 | 16% |
| flaky | 9.06 | 8% |

## Red hours per day

| Day | Hours |
| --- | --- |
| 2026-10-17 | 7.11 |
| 2026-10-19 | 2.65 |
| 2026-10-20 | 5.52 |
| 2026-10-21 | 10.96 |
| 2026-10-22 | 6.29 |
| 2026-10-23 | 15.63 |
| 2026-10-24 | 9.93 |
| 2026-10-25 | 8.87 |
| 2026-10-26 | 11.94 |
| 2026-10-27 | 5.14 |
| 2026-10-28 | 4.44 |
| 2026-10-29 | 4.36 |
| 2026-10-30 | 15.09 |

## Red hours per failing job

| Failing job | Reds | Classes |
| --- | --- | --- |
| browser-smoke | 52 | infra, production-only |
| ci-tests | 19 | infra, production-only |
| ci-checks | 5 | production-only |
| ci-prepare | 5 | infra, production-only |
| test-shard (1) | 5 | production-only |
| production-test-warning | 3 | infra |
| test-shard (0) | 3 | production-only |

## Every red run

| Run | Started | Class | Failing job | Failing step | Evidence |
| --- | --- | --- | --- | --- | --- |
| 41097628104 | 2026-10-30T17:18:14Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 41094551243 | 2026-10-30T16:57:35Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 41093994978 | 2026-10-30T16:53:48Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: inbox |
| 41089519363 | 2026-10-30T16:23:59Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 41088057992 | 2026-10-30T16:14:29Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 41083857294 | 2026-10-30T15:46:54Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › Pages fixtures › Pages list creates a document, links a ticket, persists, unlinks and separates archived pages |
| 41078553236 | 2026-10-30T15:12:32Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 41077449363 | 2026-10-30T15:05:18Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 41076899143 | 2026-10-30T15:01:45Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 41069564384 | 2026-10-30T14:10:48Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 41046900395 | 2026-10-30T11:16:28Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › docked board scope › docked AI chat follows the viewed board and keeps hand picks board-local @id:chat-follows-board |
| 41039592138 | 2026-10-30T10:16:58Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › Pages fixtures › Pages list creates a document, links a ticket, persists, unlinks and separates archived pages |
| 41032215354 | 2026-10-30T09:16:24Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: inbox |
| 41031448040 | 2026-10-30T09:10:07Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › Pages fixtures › Pages list creates a document, links a ticket, persists, unlinks and separates archived pages |
| 40996989428 | 2026-10-30T03:22:13Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 40993442776 | 2026-10-30T02:44:34Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 40987292652 | 2026-10-30T01:41:06Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 40975404540 | 2026-10-29T23:46:39Z | production-only | test-shard (1) | Test shard | actual: [ 'Pinned', 'Previous 7 days', 'Older' ], expected: [ 'Pinned', 'Today', 'Previous 7 days', 'Older' ] |
| 40958313611 | 2026-10-29T21:30:08Z | production-only | ci-checks | Typecheck | ##[error]src/lib/ai/settings/catalog.ts(45,12): error TS2741: Property 'github' is missing in type '{ readonly general: "Display name, profile picture, email and delete account"; readonly appearance: "Theme: Follow system, Light · Porcelain, Dark · Graphite, OLED black · AMOLED, Paper · Dia, Material"; ... 37 more ...; readonly announcements: "Latest updates"; }' but required in type 'Record<Setti |
| 40946522984 | 2026-10-29T20:09:41Z | production-only | ci-checks | Typecheck | ##[error]src/lib/ai/settings/catalog.ts(37,3): error TS1117: An object literal cannot have multiple properties with the same name. |
| 40871079514 | 2026-10-29T12:10:19Z | production-only | test-shard (1) | Test shard | ##[error]Process completed with exit code 1. |
| 40785961200 | 2026-10-28T23:14:43Z | production-only | ci-checks | Lint | ##[error]   79:27  error  Use a shared theme token for corners, not 'rounded-[4px]'. Existing per-file debt cannot increase  local/no-raw-design-corners |
| 40768721107 | 2026-10-28T21:03:39Z | production-only | ci-checks | Lint | ##[error]   79:27  error  Use a shared theme token for corners, not 'rounded-[4px]'. Existing per-file debt cannot increase  local/no-raw-design-corners |
| 40766529778 | 2026-10-28T20:48:23Z | production-only | ci-checks | Lint | ##[error]   79:27  error  Use a shared theme token for corners, not 'rounded-[4px]'. Existing per-file debt cannot increase  local/no-raw-design-corners |
| 40711394880 | 2026-10-28T14:59:26Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 40657599632 | 2026-10-28T08:33:06Z | production-only | test-shard (0) | Test shard | actual: [ 'tests/typed-api-client-task-adoption.test.cjs' ], expected: [] |
| 40657561075 | 2026-10-28T08:32:47Z | production-only | test-shard (1) | Test shard | actual: [ 'tests/typed-api-client-task-adoption.test.cjs' ], expected: [] |
| 40657527653 | 2026-10-28T08:32:30Z | production-only | test-shard (0) | Test shard | actual: [ 'tests/typed-api-client-task-adoption.test.cjs' ], expected: [] |
| 40457159746 | 2026-10-27T05:45:48Z | production-only | test-shard (1) | Test shard | actual: [ 'tests/global-shortcut-routes.test.cjs' ], expected: [] |
| 40435478284 | 2026-10-27T01:56:13Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock-matrix.spec.ts › layout lock matrix: search |
| 40432945553 | 2026-10-27T01:30:15Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock-matrix.spec.ts › layout lock matrix: search |
| 40409398586 | 2026-10-26T22:03:12Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock-matrix.spec.ts › layout lock matrix: search |
| 40371538167 | 2026-10-26T17:45:08Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock-matrix.spec.ts › layout lock matrix: search |
| 40371166808 | 2026-10-26T17:42:43Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock-matrix.spec.ts › layout lock matrix: search |
| 40350036388 | 2026-10-26T15:30:43Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock-matrix.spec.ts › layout lock matrix: search |
| 40325542864 | 2026-10-26T12:49:46Z | production-only | test-shard (1) | Test shard | actual: [ 'tests/typed-section-notification-writes.test.cjs' ], expected: [] |
| 40310222483 | 2026-10-26T10:48:06Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket |
| 40307417750 | 2026-10-26T10:26:22Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | Locator: getByRole('dialog').getByText('Link page', { exact: true }) Error: element(s) not found |
| 40299634497 | 2026-10-26T09:27:05Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › Pages list creates a document, links a ticket, persists, unlinks and separates archived pages |
| 40290842271 | 2026-10-26T08:14:05Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › Pages list creates a document, links a ticket, persists, unlinks and separates archived pages |
| 40280078277 | 2026-10-26T06:29:05Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › Pages list creates a document, links a ticket, persists, unlinks and separates archived pages |
| 40279768235 | 2026-10-26T06:25:52Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 40279072647 | 2026-10-26T06:18:43Z | infra | production-test-warning | Warn about failed production tests | API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID B039:2822E7:2E1A45D:96A354E:6ADEF5C2 and timestamp 2026-10-26 06:40:02 UTC. For more on scraping GitHub and how it may affect your rights, please review our Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) |
| 40277958518 | 2026-10-26T06:07:05Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | Locator: getByTestId('ai-sidebar').locator('[data-ai-chat-scope]:visible > button').first() Error: element(s) not found |
| 40263854420 | 2026-10-26T03:23:37Z | infra | production-test-warning | Warn about failed production tests | API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID 880A:9B732:1280EC0:3D4B51F:6ADECD0D and timestamp 2026-10-26 03:46:21 UTC. For more on scraping GitHub and how it may affect your rights, please review our Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) |
| 40255578310 | 2026-10-26T01:43:08Z | production-only | test-shard (0) | Test shard | ##[error]Process completed with exit code 1. |
| 40236934104 | 2026-10-25T21:44:56Z | infra | ci-prepare | Verify live required-check settings | ##[error]GitHub rate limit wait cap exceeded (300s total; 0s already waited, 739s requested); settings were not verified. |
| 40235546983 | 2026-10-25T21:27:04Z | infra | ci-prepare | Verify live required-check settings | ##[error]GitHub rate limit wait cap exceeded (300s total; 0s already waited, 1409s requested); settings were not verified. |
| 40209488391 | 2026-10-25T15:58:59Z | production-only | ci-prepare | Source-text regex gate | ##[error]Process completed with exit code 1. |
| 40208357829 | 2026-10-25T15:44:19Z | production-only | ci-prepare | Source-text regex gate | actual: [ 'tests/nextjs-build-cache.test.cjs' ], expected: [] |
| 40201291546 | 2026-10-25T14:14:20Z | production-only | ci-prepare | Source-text regex gate | actual: [ 'tests/nextjs-build-cache.test.cjs' ], expected: [] |
| 40186556991 | 2026-10-25T10:52:35Z | infra | production-test-warning | Warn about failed production tests | API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID 6C22:7F279:22D107C:7180718:6ADDE743 and timestamp 2026-10-25 11:25:55 UTC. For more on scraping GitHub and how it may affect your rights, please review our Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) |
| 40130225811 | 2026-10-24T20:32:19Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › My Tasks Tab keeps the chosen split without server navigation (time grouping) |
| 40107194290 | 2026-10-24T15:29:22Z | production-only | ci-tests | Test full suite | tests/board-filters/saved-views.test.cjs › MCP timer running/report and team presence forward the authenticated agent to real services |
| 40083950474 | 2026-10-24T09:56:46Z | production-only | ci-tests | Test full suite | actual: [ 'Task 4060', 'Task 15' ], expected: [ 'Task 15', 'Task 4060' ] |
| 40080006704 | 2026-10-24T08:56:45Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout baseline: ticket from board card |
| 40054575749 | 2026-10-24T02:32:13Z | infra | browser-smoke | Build the local app (no migrations) | An error occurred in `next/font`. |
| 40049646853 | 2026-10-24T01:24:32Z | production-only | ci-tests | Test full suite | tests/htpr-7652-ctrlj-enter-queue.test.cjs › flag off keeps the old behaviour where Enter during the board load does nothing |
| 40032745868 | 2026-10-23T22:18:28Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/inbox-cycle.spec.ts › inbox cycle: open by click, send a comment, J and E all stay in the inbox flow |
| 40028607256 | 2026-10-23T21:41:34Z | production-only | ci-tests | Test full suite | actual: [ 4060, 15 ], expected: [ 15, 4060 ] |
| 40016067548 | 2026-10-23T20:02:08Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/agent-sidebar-chats.spec.ts › switching chats does not move the ticket, its comments or its comment composer |
| 40005723685 | 2026-10-23T18:44:04Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/inbox-cycle.spec.ts › inbox cycle: open by click, send a comment, J and E all stay in the inbox flow |
| 40001244575 | 2026-10-23T18:11:18Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/agent-sidebar-chats.spec.ts › switching chats does not move the ticket, its comments or its comment composer |
| 39994890905 | 2026-10-23T17:25:08Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/inbox-cycle.spec.ts › inbox cycle: open by click, send a comment, J and E all stay in the inbox flow |
| 39973483259 | 2026-10-23T14:53:21Z | production-only | ci-tests | Test full suite | tests/ux-signoff-gate.test.cjs › UX evaluation error before rate-limited current PR remains exit 2 |
| 39967457263 | 2026-10-23T14:11:03Z | production-only | ci-tests | Test full suite | tests/ux-signoff-gate.test.cjs › UX evaluation error before rate-limited current PR remains exit 2 |
| 39963945115 | 2026-10-23T13:46:05Z | production-only | ci-tests | Test full suite | tests/ux-signoff-gate.test.cjs › UX evaluation error before rate-limited current PR remains exit 2 |
| 39955827490 | 2026-10-23T12:46:10Z | infra | ci-tests | Verify live required-check settings | ##[error]GitHub rate limit wait cap exceeded (300s total; 0s already waited, 719s requested); settings were not verified. |
| 39949912313 | 2026-10-23T11:58:46Z | infra | ci-tests | Verify live required-check settings | ##[error]GitHub rate limit wait cap exceeded (300s total; 0s already waited, 504s requested); settings were not verified. |
| 39941521264 | 2026-10-23T10:47:01Z | infra | ci-tests | Verify live required-check settings | ##[error]GitHub rate limit wait cap exceeded (300s total; 0s already waited, 491s requested); settings were not verified. |
| 39913860709 | 2026-10-23T06:49:27Z | infra | ci-tests | Verify live required-check settings | ##[error]GitHub rate limit wait cap exceeded (300s total; 0s already waited, 354s requested); settings were not verified. |
| 39909111225 | 2026-10-23T06:02:24Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › My Tasks Tab keeps the chosen split without server navigation (board grouping) |
| 39893472082 | 2026-10-23T03:09:16Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/prod.spec.ts › My Tasks Tab keeps the chosen split without server navigation (board grouping) |
| 39883550562 | 2026-10-23T01:21:44Z | infra | browser-smoke | Build the local app (no migrations) | An error occurred in `next/font`. |
| 39792198835 | 2026-10-22T14:02:02Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget |
| 39787853372 | 2026-10-22T13:33:16Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock |  |
| 39784077960 | 2026-10-22T13:07:15Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget |
| 39770072034 | 2026-10-22T11:22:22Z | production-only | ci-tests | Test full suite | tests/htpr-7574-agent-onboarding.test.cjs › S4 refused: admin self-change gives owner guidance before checking role |
| 39765957007 | 2026-10-22T10:49:20Z | production-only | ci-tests | Test full suite | tests/htpr-7574-agent-onboarding.test.cjs › S4 refused: admin self-change gives owner guidance before checking role |
| 39722123795 | 2026-10-22T04:23:39Z | production-only | ci-tests | Test full suite | tests/htpr-7322-agent-feature-discovery.test.cjs › Question lines qualify; ordinary mentions and questions answered later by the viewer do not |
| 39719731623 | 2026-10-22T03:58:06Z | production-only | ci-tests | Test full suite | tests/htpr-7322-agent-feature-discovery.test.cjs › Question lines qualify; ordinary mentions and questions answered later by the viewer do not |
| 39675288000 | 2026-10-21T21:01:10Z | infra | ci-tests | Verify live required-check settings | gh: API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID B421:3FF282:139DB92:3FB8017:6AD928AB and timestamp 2026-10-21 21:03:39 UTC. For more on scraping GitHub and how it may affect your rights, please review our Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) (HTTP 403) |
| 39666545566 | 2026-10-21T20:00:31Z | infra | ci-tests | Verify live required-check settings | gh: API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID 0841:320CAD:EB4C36:2F9A231:6AD91C91 and timestamp 2026-10-21 20:12:01 UTC. For more on scraping GitHub and how it may affect your rights, please review our Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) (HTTP 403) |
| 39608518494 | 2026-10-21T13:29:59Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget |
| 39580239278 | 2026-10-21T09:51:53Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget |
| 39567066934 | 2026-10-21T08:08:43Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget |
| 39466076362 | 2026-10-20T17:26:23Z | production-only | ci-tests | Test with coverage collection |  |
| 39465257750 | 2026-10-20T17:20:45Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget |
| 39405668595 | 2026-10-20T10:07:25Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget |
| 39302143086 | 2026-10-19T18:23:51Z | production-only | browser-smoke | Serve and check logged-in pages and layout lock | e2e/smoke/layout-lock.spec.ts › layout lock: ticket page first load stays under the CLS budget |
| 39225804438 | 2026-10-19T08:51:51Z | infra | browser-smoke | Build the local app (no migrations) | An error occurred in `next/font`. |
| 39010338863 | 2026-10-17T06:33:16Z | production-only | ci-tests | Test with coverage collection | tests/task-writer-due-date.test.cjs › app existing empty ticket uses the normal update controller and resets its due-date job |

## Red then green on rerun

| Run | Started | Branch | Attempts |
| --- | --- | --- | --- |
| 41099580673 | 2026-10-30T17:31:35Z | production | 2 |
| 41086980579 | 2026-10-30T16:07:19Z | production | 2 |
| 41081002156 | 2026-10-30T15:28:15Z | production | 2 |
| 41072486333 | 2026-10-30T14:32:43Z | production | 2 |
| 41057124807 | 2026-10-30T12:40:32Z | production | 2 |
| 41015205958 | 2026-10-30T06:37:54Z | production | 2 |
| 40470727429 | 2026-10-27T08:01:39Z | production | 4 |
| 40190462541 | 2026-10-25T11:49:15Z | production | 2 |
| 40177193452 | 2026-10-25T08:35:01Z | production | 2 |
| 40145720792 | 2026-10-25T00:11:23Z | production | 2 |
| 40143076908 | 2026-10-24T23:31:18Z | production | 2 |
| 40134852502 | 2026-10-24T21:34:54Z | production | 3 |
| 40124803262 | 2026-10-24T19:19:58Z | production | 3 |
| 40111027887 | 2026-10-24T16:19:33Z | production | 2 |
