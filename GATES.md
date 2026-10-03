# Gates: HTPR-6662 agent log command name

OWNS: GATES.md, src/components/Modals/commands/HTC/AllCommands.ts, src/components/Modals/commands/HTC/taskCommands.ts, src/components/Modals/commands/HTC/commands.tsx, src/components/Modals/Settings/ShortcutsSection.tsx, src/components/sidebars/keyboardShortcuts.tsx, src/lib/constants/shortcuts.ts, src/lib/flags.ts, src/lib/flags/keys.ts, tests/feature-flags.test.cjs, tests/agent-log-command.test.cjs, tests/cmdk-ticket-prefix.test.cjs

Scope: Rename the task history toggle behind htpr-6662-agent-log-name, preserve search and shortcut behavior, verify, and commit only in this worktree for https://app.hypertask.ai/detail/project-15/6662.

- [x] G0: The ledger has valid, falsifiable checks.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=07de1a3fdbb119780824944843dcfc7da4b1349f87411f5d2df255b3caa7c614; output-bytes=150; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries

- [x] G1: Flag-on and flag-off toggle labels, search keywords, component wiring, help labels, and Ctrl+Shift+H satisfy acceptance.
  CHECK: node --test tests/agent-log-command.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=b507f6a36c1719e8110262e8e376a63d762e8a8e9ed585a931d7314ca3d85650; exit=0; EXPECT=matched; output-sha256=7f8137942f068b0b2be4b09f246b84b51eb712fc945fe25dc62822be0d5468d3; output-bytes=1273; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries

- [x] G2: The ticket-specific flag is registered with Owner + QA defaults and flag regression tests pass.
  CHECK: node --test tests/feature-flags.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=844483964cc8049bc11536d4fcdc7d55bd9136a5137131c40d2483b390fa9b96; exit=0; EXPECT=matched; output-sha256=673e04a12caed12aa86cd6a4513ffb9e62c19ac313a29e0a3d3cc593b405cfcd; output-bytes=4619; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries

- [x] G3: The local IMPROVE feature-flag check passes using the workflow's title, base SHA, head SHA, and empty labels.
  CHECK: candidate=$(git commit-tree "$(git write-tree)" -p HEAD -m 'HTPR-6662 [IMPROVE] Name the agent log toggle clearly in Ctrl+K') && FEATURE_FLAG_PR_LABELS='[]' node .github/scripts/feature-flag-gate.mjs 'HTPR-6662 [IMPROVE] Name the agent log toggle clearly in Ctrl+K' "$(git rev-parse origin/production)" "$candidate"
  EXPECT: calls ticket-specific feature gate htpr-6662-agent-log-name
  EVIDENCE: automatic-evidence=v1; definition-sha256=3f0e79566bb7285cb13d3c9dc21ab5d3106f0b6f1831135ce69575b05a4f65bb; exit=0; EXPECT=matched; output-sha256=c4a9813b6d07250ebb663ac417783486dcafe521698380ef88979b0ae91f7fa2; output-bytes=168; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries

- [x] G4: Full TypeScript diagnostics match the starting production revision exactly, with no new errors.
  CHECK: node -e 'const ts=require("typescript"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{execFileSync:run}=require("node:child_process"); let current; try { current=run("npx",["tsc","--noEmit","-p",".","--incremental","false"],{encoding:"utf8",maxBuffer:16777216}); } catch(error) { assert.ok([1,2].includes(error.status)); current=error.stdout; } const base=run("git",["merge-base","origin/production","HEAD"],{encoding:"utf8"}).trim(); const files=run("git",["diff","--name-only",base,"--","src"],{encoding:"utf8"}).trim().split("\n").filter(file=>/\.tsx?$/.test(file)); const originals=new Map(files.map(file=>[path.resolve(file),run("git",["show",`${base}:${file}`],{encoding:"utf8"})])); const config=ts.getParsedCommandLineOfConfigFile("tsconfig.json",{incremental:false},{...ts.sys,onUnRecoverableConfigFileDiagnostic:diagnostic=>{throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText,"\n"));}}); const host=ts.createCompilerHost(config.options),read=host.readFile; host.readFile=file=>originals.get(path.resolve(file))??read(file); const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram(config.fileNames,config.options,host)); const output=ts.formatDiagnostics(diagnostics,{getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:name=>name,getNewLine:()=>"\n"}); assert.equal(current.trim(),output.trim(),"Current diagnostics must exactly match the production base"); console.log(`TypeScript baseline verification passed: ${diagnostics.length} identical pre-existing diagnostics; no new errors`);'
  EXPECT: TypeScript baseline verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=902df65cd97e2e260d2ef2348eca77998a83770a6571f98f861b95f69a82c4bd; exit=0; EXPECT=matched; output-sha256=f3f08107d849975bdd6bdb9e3edb9341b4cf02a8c2305f96c30d290663add391; output-bytes=94; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries

- [x] G5: Changed application files pass the project's lint command.
  CHECK: npm run lint -- src/components/Modals/commands/HTC/AllCommands.ts src/components/Modals/commands/HTC/commands.tsx src/components/Modals/commands/HTC/taskCommands.ts src/components/Modals/Settings/ShortcutsSection.tsx src/components/sidebars/keyboardShortcuts.tsx src/lib/constants/shortcuts.ts src/lib/flags/keys.ts src/lib/flags.ts && printf 'Lint verification passed\n'
  EXPECT: Lint verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=68639361358343af2ec42366b946e0411032f7eaecfdeeaf5b0e3e2bf03374cf; exit=0; EXPECT=matched; output-sha256=a140c6f7f7cebe403faade9382c0c445dbe27fc19c7a99c16caa5a02c72ee06b; output-bytes=7601; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries

- [x] G6: The patch has no whitespace errors or added em dashes, with a positive control for the dash detector.
  CHECK: git diff --check HEAD && git diff --cached --check && node -e 'const assert=require("node:assert/strict"),{execFileSync:run}=require("node:child_process"); const base=run("git",["merge-base","origin/production","HEAD"],{encoding:"utf8"}).trim(); const added=diff=>diff.split("\n").filter(line=>line.startsWith("+")&&!line.startsWith("+++")).join("\n"); assert.ok(added("+copy \u2014").includes("\u2014")); assert.ok(!added(run("git",["diff",base],{encoding:"utf8"})).includes("\u2014")); console.log("Patch constraints verification passed");'
  EXPECT: Patch constraints verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=bd1194838aba648d14a1e3977873f787e21c12137f12593cbaa51f524f590222; exit=0; EXPECT=matched; output-sha256=009a4774838a80629e161d4a1435a5e13f061e9d3dadc27f792959c46f21ccfa; output-bytes=38; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries

- [x] G7: The branch contains the requested commit subject and final co-author trailer.
  CHECK: node -e 'const assert=require("node:assert/strict"),{execFileSync:run}=require("node:child_process"); assert.equal(run("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"htpr-6662"); const message=run("git",["log","-1","--format=%B"],{encoding:"utf8"}).trim(); assert.match(message,/^HTPR-6662: .+/); assert.ok(message.endsWith("Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>")); console.log("Commit verification passed");'
  EXPECT: Commit verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=84ac8c02699843812abe06c06af4bc260cfbfbf22a71a45b8fe43bd61dcd03c9; exit=0; EXPECT=matched; output-sha256=d9faff69e89027855ccfc3a2da7cb7f3f9066cc64e9f58de434c5fcfa34091d3; output-bytes=27; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries

- [x] G8: The changes use existing UI, remain in this worktree, and do not write to the board, push, or open a PR.
  EVIDENCE: Reviewed code commit 4fb155d83: eight existing application files and three Node test files only. Existing command and shortcut-help components are reused; no new UI, endpoint, action, or permission is introduced. All repository writes and commands used /home/valentin/projects/ht-wt-6662 on htpr-6662. Session tool history contains no board CLI or API writes, push, PR creation, stash, or changes to another worktree; no secret files were read or printed.

- [x] G9: Existing palette, task-command, triage, and shortcut-help regressions pass.
  CHECK: node --test tests/cmdk-ticket-prefix.test.cjs tests/task-detail-inbox-flow.test.cjs tests/task-command-frecency.test.cjs tests/triage-commands.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=eb546c48e8a2d7290f9e12407235435059359876c2cfae6f3464dd42b0c3ab29; exit=0; EXPECT=matched; output-sha256=851cf1b05b91f064d3f58740187f275396d330d6053559b56c81dcef74024dfd; output-bytes=3959; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6662; path=fd5351737ae0/31 entries
