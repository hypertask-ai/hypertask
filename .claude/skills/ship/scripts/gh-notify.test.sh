#!/usr/bin/env bash
# Offline test for the GitHub notify path (YPER4-881): runner-webhook POST /github/notify and ci-wait.
set -uo pipefail
cd "$(dirname "$0")"
passes=0 fails=0
ok() { passes=$((passes + 1)); echo "ok - $1"; }
bad() { fails=$((fails + 1)); echo "not ok - $1"; }
eq() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
T=$(mktemp -d); PIDS=""
trap 'kill $PIDS 2>/dev/null; rm -rf "$T"' EXIT
mkdir -p "$T/claims" "$T/inbox" "$T/notify"
printf '111 hypertask-ai/hypertask\n112 valentinyeo/postbox\n' > "$T/hooks"
mkdir -p "$T/truth"
printf fixture-secret > "$T/secret"
printf 100 > "$T/run-id"
# Fake gh for the receiver's read-back: answers from $T/truth/<api path with / as _>, else fails.
printf '#!/bin/sh\necho read >> "%s/readbacks"\nf="%s/truth/$(echo "$2" | tr / _)"\n[ -f "$f" ] && cat "$f" || exit 1\n' "$T" "$T" > "$T/srvgh"
printf '#!/bin/sh\n[ -f "%s/deliver.fail" ] && { rm -f "%s/deliver.fail"; cat >/dev/null; exit 1; }\nprintf "%%s|%%s|%%s\\n" "$1" "$RUNNER_DELIVER_ID" "$(cat)" >> "%s/deliver.log"\n' "$T" "$T" "$T" > "$T/deliver"
printf '#!/bin/sh\nprintf "%%s|%%s|%%s\\n" "$1" "$4" "$2" >> "%s/say.log"\n' "$T" > "$T/say"
chmod +x "$T/deliver" "$T/say" "$T/srvgh"
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
RUNNER_INBOX_DIR=$T/inbox RUNNER_DELIVER=$T/deliver GH_NOTIFY_DIR=$T/notify GH_NOTIFY_HOOKS=$T/hooks GH_NOTIFY_CLAIMS=$T/claims GH_NOTIFY_SECRET=$T/secret \
  GH_NOTIFY_SESSION_SAY=$T/say GH_NOTIFY_GH=$T/srvgh RUNNER_WEBHOOK_PORT=$PORT RUNNER_WEBHOOK_FALLBACK_PORT=1 python3 ./runner-webhook 2>"$T/server.log" & PIDS="$PIDS $!"
for _ in $(seq 50); do curl -fs "http://127.0.0.1:$PORT/runner-webhook/healthz" >/dev/null 2>&1 && break; sleep 0.1; done
post() { # hook-id event delivery body
  local signature
  signature=$(printf '%s' "$4" | openssl dgst -sha256 -hmac fixture-secret | awk '{print $NF}')
  curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/github/notify" -H "X-GitHub-Hook-ID: $1" \
    -H "X-GitHub-Event: $2" -H "X-Hub-Signature-256: sha256=$signature" -H "X-GitHub-Delivery: $3" -H 'Content-Type: application/json' --data "$4"
}
run() { # repo branch workflow conclusion pr sha [forged]; GitHub agrees unless forged
  local RUNID
  RUNID=$(($(cat "$T/run-id") + 1))
  printf '%s' "$RUNID" > "$T/run-id"
  [ -n "${7:-}" ] || jq -nc --arg b "$2" --arg c "$4" --arg w "$3" --arg s "$6" --argjson p "$5" '[$b, $c, $w, $s, $p] | @json' | jq -r . > "$T/truth/repos_$(echo "$1" | tr / _)_actions_runs_$RUNID"
  jq -nc --arg r "$1" --arg b "$2" --arg w "$3" --arg c "$4" --argjson p "$5" --arg s "$6" --argjson id "$RUNID" \
    '{action:"completed", repository:{full_name:$r}, workflow_run:{id:$id, name:$w, head_branch:$b, conclusion:$c, head_sha:$s, html_url:"https://evil.example", pull_requests:[{number:$p}]}}'
}
closed() { # repo branch pr
  jq -nc --arg b "$2" --argjson p "$3" '[$b, "closed", true, "m1", $p] | @json' | jq -r . > "$T/truth/repos_$(echo "$1" | tr / _)_pulls_$3"
  jq -nc --arg r "$1" --arg b "$2" --argjson p "$3" '{action:"closed", repository:{full_name:$r}, pull_request:{number:$p, merged:true, merge_commit_sha:"m1", html_url:"u", head:{ref:$b}}}'
}
lines() { [ -f "$1" ] && wc -l < "$1" | tr -d ' ' || echo 0; }
settle() { for _ in $(seq 30); do [ "$(lines "$1")" -ge "$2" ] && return; sleep 0.1; done; }

unsigned=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/github/notify" -H 'X-GitHub-Hook-ID: 111' --data '{}')
eq "unsigned allowed hook gets 401" "$unsigned" 401
[ ! -f "$T/notify/events.log" ] && ok "unsigned request writes no state" || bad "unsigned request wrote state"
eq "unknown hook id gets 404" "$(post 999 workflow_run d0 "$(run hypertask-ai/hypertask runner7/yper4-1 'CI Tests' failure 5 a1)")" 404
eq "missing hook id gets 404" "$(post '' workflow_run d0 '{}')" 404
eq "other events are ignored" "$(post 111 push d1 '{}')" 202
eq "bad json is 400" "$(post 111 workflow_run d2 'nope')" 400
eq "CI failure accepted" "$(post 111 workflow_run d3 "$(run hypertask-ai/hypertask runner7/yper4-1 'CI Tests' failure 5 a1)")" 202
f=$T/notify/hypertask-ai__hypertask/runner7_yper4-1.json
[ -f "$f" ] && ok "state file written" || bad "state file missing"
eq "state file names the conclusion" "$(jq -r .conclusion "$f" 2>/dev/null)" failure
settle "$T/deliver.log" 1
eq "failure woke Runner 7 once" "$(cut -d'|' -f1 "$T/deliver.log" 2>/dev/null)" 7
grep -q 'CI Tests failed on PR #5' "$T/deliver.log" && ok "message names the workflow and PR" || bad "message text"
grep -q 'evil.example' "$T/deliver.log" && bad "payload URL reached the message" || ok "message URL is built by us, not taken from the payload"
eq "message is one line" "$(lines "$T/deliver.log")" 1
post 111 workflow_run d4 "$(run hypertask-ai/hypertask runner7/yper4-1 'Lint' failure 5 a1)" >/dev/null
sleep 0.5; eq "second failure on the same commit does not wake again" "$(lines "$T/deliver.log")" 1
replay_id=$(jq -r .run "$f")
replay=$(jq -nc --argjson run "$replay_id" '{action:"completed", repository:{full_name:"hypertask-ai/hypertask"}, workflow_run:{id:$run, name:"Lint", head_branch:"runner7/yper4-1", conclusion:"failure", head_sha:"zz", pull_requests:[{number:99}]}}')
original=$(jq '.workflow_run.head_sha="a1" | .workflow_run.pull_requests[0].number=5' <<<"$replay")
reads_before=$(lines "$T/readbacks")
post 111 workflow_run d4original "$original" >/dev/null
sleep 0.5; eq "verified duplicate consumes no read-back capacity" "$(lines "$T/readbacks")" "$reads_before"
post 111 workflow_run d4b "$replay" >/dev/null
sleep 0.5; eq "replayed run with a forged sha and PR does not wake again" "$(lines "$T/deliver.log")" 1
eq "forged identity reaches GitHub read-back" "$(lines "$T/readbacks")" "$((reads_before + 1))"
eq "matching replay passes workflow verification" "$(grep -c 'read-back did not match' "$T/server.log")" 0
post 111 workflow_run d5 "$(run hypertask-ai/hypertask runner7/yper4-1 'Lint' success 5 a2)" >/dev/null
sleep 0.5; eq "a pass outside CI Tests does not wake" "$(lines "$T/deliver.log")" 1
post 111 workflow_run d6 "$(run hypertask-ai/hypertask runner7/yper4-1 'Lint' cancelled 5 a3)" >/dev/null
sleep 0.5; eq "a cancelled run does not wake" "$(lines "$T/deliver.log")" 1
eq "payload repo must match the hook's repo" "$(post 111 workflow_run d6b "$(run valentinyeo/postbox runner7/yper4-1 'CI Tests' failure 5 f1)")" 403
eq "forged event is accepted as a hint" "$(post 111 workflow_run d6c "$(run hypertask-ai/hypertask runner7/yper4-9 'CI Tests' failure 5 f2 forged)")" 202
sleep 0.5; eq "forged event GitHub does not confirm wakes nobody" "$(lines "$T/deliver.log")" 1
touch "$T/deliver.fail"
post 111 workflow_run d6d "$(run hypertask-ai/hypertask runner7/yper4-3 'CI Tests' failure 5 r1)" >/dev/null
sleep 0.7; eq "failed delivery sends nothing" "$(lines "$T/deliver.log")" 1
post 111 workflow_run d6e "$(run hypertask-ai/hypertask runner7/yper4-3 'CI Tests' failure 5 r1)" >/dev/null
settle "$T/deliver.log" 2
eq "failed delivery is retried by the next event for the commit" "$(lines "$T/deliver.log")" 2
echo '{"ticket":"IGSH-5","runner":"Hax Runner 3"}' > "$T/claims/IGSH-5.json"
eq "SF merge accepted" "$(post 112 pull_request d7 "$(closed valentinyeo/postbox ceo/IGSH-5 9)")" 202
settle "$T/say.log" 1
eq "SF merge goes to the claiming hax runner" "$(cut -d'|' -f1,2 "$T/say.log" 2>/dev/null)" "hax-runner-3|github"
echo '{"ticket":"YPER4-2","runner":"RUNNER 12"}' > "$T/claims/YPER4-2.json"
post 111 pull_request d8 "$(closed hypertask-ai/hypertask yper4-2-fix 10)" >/dev/null
settle "$T/deliver.log" 3
eq "claim file maps a branch without a runner prefix" "$(tail -1 "$T/deliver.log" | cut -d'|' -f1)" 12
post 111 pull_request d9 "$(closed hypertask-ai/hypertask someone/else 11)" >/dev/null
sleep 0.5; eq "unowned branch wakes nobody" "$(lines "$T/deliver.log")" 3
mkdir -p "$T/notify/waiters"; sleep 300 & W=$!; PIDS="$PIDS $W"
echo "hypertask-ai/hypertask runner8/x" > "$T/notify/waiters/$W"
post 111 workflow_run d10 "$(run hypertask-ai/hypertask runner8/x 'CI Tests' failure 6 b1)" >/dev/null
sleep 0.5; eq "a live ci-wait on the branch suppresses the message" "$(lines "$T/deliver.log")" 3
kill $W 2>/dev/null; wait $W 2>/dev/null
post 111 workflow_run d11 "$(run hypertask-ai/hypertask runner8/x 'CI Tests' failure 6 b2)" >/dev/null
settle "$T/deliver.log" 4
eq "a dead waiter file does not suppress it" "$(lines "$T/deliver.log")" 4

for conclusion in timed_out startup_failure; do
  before=$(lines "$T/deliver.log")
  post 111 workflow_run "failure-$conclusion" "$(run hypertask-ai/hypertask runner7/yper4-1 'CI Tests' "$conclusion" 5 "$conclusion")" >/dev/null
  settle "$T/deliver.log" "$((before + 1))"
  eq "$conclusion wakes an idle owner" "$(lines "$T/deliver.log")" "$((before + 1))"
  eq "$conclusion is preserved in branch state" "$(jq -r .conclusion "$f")" "$conclusion"
  eq "$conclusion reaches the correct owner" "$(tail -1 "$T/deliver.log" | cut -d'|' -f1)" 7
  tail -1 "$T/deliver.log" | grep -q 'CI Tests failed on PR #5' && ok "$conclusion names the verified PR" || bad "$conclusion message"
done

# ci-wait: blocks on the state file, reads checks only after a change.
cat > "$T/gh" <<G
#!/bin/sh
{ printf "%s " "\$*" | tr "\\n" " "; echo; } >> "$T/gh.log"
case "\$*" in *headRefName*) echo runner8/x ;; *statusCheckRollup*) cat "$T/rollup" ;; esac
G
roll() { # state then name:status:conclusion ...
  local st=$1; shift
  printf '%s\n' "$@" | jq -Rn --arg st "$st" '{state:$st, statusCheckRollup:[inputs | split(":") | {__typename:"CheckRun", name:.[0], status:.[1], conclusion:(.[2] // "")}]}' > "$T/rollup"
}
chmod +x "$T/gh"; roll OPEN "CI Tests:IN_PROGRESS:" "Lint:COMPLETED:SUCCESS"
for repo in '' 'not-a-repository' 'owner/repo/extra'; do
  CI_WAIT_GH=$T/gh GH_NOTIFY_DIR=$T/notify ./ci-wait 6 --repo "$repo" >/dev/null 2>&1
  eq "invalid explicit repository exits 3 ($repo)" "$?" 3
done
[ ! -e "$T/gh.log" ] && ok "invalid repository makes no GitHub reads" || bad "invalid repository read GitHub"
( CI_WAIT_GH=$T/gh GH_NOTIFY_DIR=$T/notify CI_WAIT_TICK=1 CI_WAIT_GAP=0 ./ci-wait 6 --repo hypertask-ai/hypertask --timeout 30 > "$T/cw.out"; echo $? > "$T/cw.rc" ) &
CW=$!
sleep 3
eq "ci-wait read the checks once and then waits" "$(grep -c statusCheckRollup "$T/gh.log")" 1
[ -n "$(ls "$T/notify/waiters" 2>/dev/null | grep -v "^$W$")" ] && ok "ci-wait registered as a waiter" || bad "no waiter file"
roll OPEN "CI Tests:COMPLETED:SUCCESS" "Lint:COMPLETED:SUCCESS" "Docs:COMPLETED:SKIPPED"
sleep 2; eq "no gh read without a notify" "$(grep -c statusCheckRollup "$T/gh.log")" 1
post 111 workflow_run d12 "$(run hypertask-ai/hypertask runner8/x 'CI Tests' success 6 b3)" >/dev/null
wait $CW
eq "ci-wait exits 0 after the notify" "$(cat "$T/cw.rc")" 0
eq "two check reads in total" "$(grep -c statusCheckRollup "$T/gh.log")" 2
eq "waiter file removed" "$(ls "$T/notify/waiters" | grep -vc "^$W$")" 0
roll OPEN "CI Tests:COMPLETED:FAILURE" "Lint:IN_PROGRESS:"
CI_WAIT_GH=$T/gh GH_NOTIFY_DIR=$T/notify ./ci-wait 6 --repo hypertask-ai/hypertask >/dev/null; eq "failed check exits 1" "$?" 1
roll OPEN "CI Tests:COMPLETED:CANCELLED" "Lint:COMPLETED:SUCCESS"
out=$(CI_WAIT_GH=$T/gh GH_NOTIFY_DIR=$T/notify ./ci-wait 6 --repo hypertask-ai/hypertask); eq "cancelled check is not a pass" "$?" 1
grep -q 'CI Tests (cancelled)' <<<"$out" && ok "cancelled check is named" || bad "cancelled not named: $out"
roll MERGED "CI Tests:COMPLETED:CANCELLED"
CI_WAIT_GH=$T/gh GH_NOTIFY_DIR=$T/notify ./ci-wait 6 --repo hypertask-ai/hypertask >/dev/null; eq "merged PR exits 0" "$?" 0
roll OPEN "CI Tests:COMPLETED:SUCCESS" "Lint:QUEUED:"
CI_WAIT_GH=$T/gh GH_NOTIFY_DIR=$T/notify CI_WAIT_TICK=1 ./ci-wait 6 --repo hypertask-ai/hypertask --timeout 2 >/dev/null; eq "timeout exits 2" "$?" 2
./ci-wait abc >/dev/null 2>&1; eq "bad usage exits 3" "$?" 3
grep -q 'CI_WAIT_FALLBACK=600\|FALLBACK=600' ci-wait && ok "fallback poll floor is 600 s" || bad "fallback floor"
echo "$passes passed, $fails failed"
[ "$fails" = 0 ] && echo "ALL PASS"
exit "$fails"
