# Gates: Slack app parity and identity

Scope: Port the read-only Worker and archived PR into this worktree, behind htpr-6817-slack-app, with real-person authorization and unchanged legacy behavior when disabled. No board writes, push, PR, secret output, other-worktree changes, Marketplace work, or Worker retirement.

- [x] G1: Slack signatures reject invalid, stale and malformed requests on all new ingress routes
  CHECK: node --test tests/slack-app-signature.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=5f7a157fd87a6ce62b7a3dad5bf786c0855062b1dbbcdeeba96a3c127e43e769; exit=0; EXPECT=matched; output-sha256=83bad75fa358c935979706af0c399cf3af8887331251fc8f6088a6788435b124; output-bytes=1479; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=fd5351737ae0/31 entries

- [x] G2: Every Worker slash command parses and dispatches with correct validation and Block Kit output
  CHECK: node --test tests/slack-app-commands.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=759721d85d01ca6c2e9f7f2bedcec175b5fb0d142be1960f8f7068fdc3f46641; exit=0; EXPECT=matched; output-sha256=6249002d933541c284512ed0b6310a526eba2de45f5fbd493fb17accfb56c6b9; output-bytes=3301; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=fd5351737ae0/31 entries

- [x] G3: Verified team email and explicit connect resolve only authorized real-person identities
  CHECK: node --test tests/slack-app-identity.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=016856af0cb400de0bdc2451ff78efeb58a4b5e1a53f8e061fd49b8e97601b33; exit=0; EXPECT=matched; output-sha256=f01d1622073d585117ff71e44bb5eda4706dfba4ad8d4a18dda7e8c273644f93; output-bytes=2327; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=fd5351737ae0/31 entries

- [x] G4: Mentions, DMs and assistant threads use all Worker tools, while flag off preserves legacy Slack behavior and ambient identity
  CHECK: node --test tests/slack-app-integration.test.cjs tests/slack-app-actions.test.cjs tests/slack-app-events.test.cjs tests/slack-integration.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=7caaadcaeabeb8e7255163205330a22845c4c28e265e270089bccfd20527d641; exit=0; EXPECT=matched; output-sha256=dba946726cbe4d6a4ed783499529adb7fdbfb5094ab446c04204089fff295f77; output-bytes=14909; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=fd5351737ae0/31 entries

- [x] G5: Changed TypeScript has no diagnostics, introduces no production-baseline diagnostics elsewhere, and changed-file lint passes
  CHECK: node tests/slack-app-checks.cjs
  EXPECT: SLACK APP CHECKS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a835533420a821e463f416503655d5528794484c57d546d255bd30ba40670b29; exit=0; EXPECT=matched; output-sha256=1242ede4d9a965246f2da053f962e608b431cebdb939c6dd827f2e9b26b021f1; output-bytes=1430; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=fd5351737ae0/31 entries

- [x] G6: Manifest documentation covers required scopes, endpoints, assistant events and safe rollout
  CHECK: node --test tests/slack-app-docs.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=f7dbc8f8114a9552ad9b0082562efe845933a45d9ca5c70dc61f277c10c5245c; exit=0; EXPECT=matched; output-sha256=77f8b5d26772816d8758ca72515f14bdbed2e52bc659730e6fafbedfeea3f04e; output-bytes=775; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=fd5351737ae0/31 entries

- [x] G7: Port reviewed against archived PR and Worker, with no missing parity or security paths
  EVIDENCE: Read-only gh pr diff 2155 -R hypertask-ai/hypertasks confirmed the command, action, linking, Block Kit and chat port is already in production. Compared /home/valentin/projects/ht-slack/src/slack/commands.ts, src/llm/tools.ts and src/index.ts with current app handlers: every slash command and tool action is exercised by the command, chat and real-controller tests. Reviewed signatures before parsing, single-use two-party linking, installing-team and project scopes, requester-private channel output, actor attribution, ambient integration attribution and flag-off branches. Fixed named-project create interception, target-mention removal, first-contact flag inheritance, repeated context metadata and immediate disconnect relinking. Only this worktree was written; no board commands, push, PR or Worker modifications were performed. Live deployment and Slack configuration are explicitly outside this local-only request.

- [x] G8: Implementation is committed on htpr-6817 with the required subject and co-author, no added em dashes or unintended changes
  CHECK: node tests/slack-app-repository.cjs
  EXPECT: SLACK APP REPOSITORY PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=10ac06dcb364661a3b239768bb4726d58c70bae66954938e94c313f12133b1bf; exit=0; EXPECT=matched; output-sha256=a825ad4cbb137fb03a61d43c60cd096e43b0ab8db0d680897572dc855ee17d0c; output-bytes=28; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=fd5351737ae0/31 entries

## Measured results

- `node --test tests/slack-app-*.test.cjs tests/slack-integration.test.cjs`: 107 passed, 0 failed, 0 skipped.
- `npx tsc --noEmit -p .`: failed with 15 production-baseline diagnostics, 0 in changed TypeScript. The compiler-host baseline comparison confirmed no introduced diagnostics elsewhere. Cached noEmit uses exit 1; fresh compilation may use exit 2. Both are diagnostic failures, never treated as a clean full-project typecheck.
- `npm run lint` with explicit changed-file ignore overrides: 21 files, exit 0, 0 warnings.
- Gate checker: 8 met, 0 unmet, 0 abandoned. All runnable evidence binds its current CHECK/EXPECT definition.
- Implementation commit: `f2dd363be`. Acceptance proof and the cached-typecheck harness correction are recorded in the following local commit.
- No live Slack calls or product data were used in tests. Slack app configuration and live verification remain deployment follow-up work. Disconnect opt-out relies on persistent Redis, as documented in `docs/slack-app.md`.

