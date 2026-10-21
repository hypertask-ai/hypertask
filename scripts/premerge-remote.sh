#!/usr/bin/env bash
set -euo pipefail
set +x
usage() { echo 'Usage: scripts/premerge-remote.sh <pr> <click-script-path.mjs>' >&2; }
if [ "$#" -ne 2 ] || [[ ! $1 =~ ^[1-9][0-9]*$ ]]; then usage; exit 2; fi
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
pr=$1
click=$2
node "$root/scripts/premerge-click-guard.mjs" path "$click" || { usage; exit 2; }
cd "$root"
repo=hypertask-ai/hypertask
state=$(mktemp -d)
chmod 700 "$state"
trap 'rm -rf "$state"' EXIT
# Serialize this runner's requests for the same PR. Ambiguous cross-runner dispatches fail closed below.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/hypertask-premerge-$UID-$pr.lock"
flock -n 9 || { echo 'A remote premerge request for this PR is already running.' >&2; exit 1; }
gh api "repos/$repo/pulls/$pr" >"$state/pr.json"
sha=$(node scripts/premerge-click-guard.mjs pull "$state/pr.json" "$repo")
# The PR must contain the click module; no unpushed local script is used.
gh api "repos/$repo/contents/$click?ref=$sha" --jq .type | { read -r type; [ "$type" = file ]; }
# Exactly the local launcher's plain/QA views and Everyone-preserving mode resolver.
node --input-type=module - "$state/flags.json" <<'NODE'
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { QA_ACCOUNT_STATE, localFlagModes, readPlainQaFlags } from './scripts/premerge-local-flags.mjs';
try {
  const root = process.cwd();
  const jiti = createRequire(path.join(root, 'package.json'))('jiti')(import.meta.url, {
    interopDefault: true, alias: { '@': path.join(root, 'src') },
  });
  const { FEATURE_FLAG_KEYS, defaultFeatureFlagMode } = jiti(path.join(root, 'src/lib/flags.ts'));
  const defaults = Object.fromEntries(FEATURE_FLAG_KEYS.map(key => [key, defaultFeatureFlagMode(key)]));
  const plain = await readPlainQaFlags();
  const qa = await readPlainQaFlags(QA_ACCOUNT_STATE);
  const modes = localFlagModes(defaults, plain, [], qa);
  for (const [key, released] of Object.entries(plain)) if (released) modes[key] = 'EVERYONE';
  await writeFile(process.argv[2], JSON.stringify({ modes, plain }), { mode: 0o600 });
} catch {
  console.error('Cannot capture live flag modes with the plain and QA storage states. No workflow dispatched.');
  process.exitCode = 1;
}
NODE
node scripts/premerge-click-guard.mjs flags "$state/flags.json"
flags=$(base64 -w0 "$state/flags.json")
# GitHub limits workflow_dispatch input payloads to 65,535 characters.
[ "${#flags}" -lt 60000 ] || { echo 'Flag snapshot exceeds workflow dispatch input limit.' >&2; exit 1; }
actor=$(gh api user --jq .login)
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh run list --repo "$repo" --workflow premerge-click.yml --event workflow_dispatch --branch production --user "$actor" --limit 100 --json databaseId >"$state/before.json"
gh workflow run premerge-click.yml --repo "$repo" --ref production -f "pr=$pr" -f "click=$click" -f "flags=$flags" >/dev/null
# Only discovery retries. The long build is watched by gh, not a shell polling loop.
run=''
for delay in 1 2 4 8 16 32; do
  gh run list --repo "$repo" --workflow premerge-click.yml --event workflow_dispatch --branch production --user "$actor" --created ">=$started" --limit 100 --json databaseId,displayTitle,url >"$state/after.json"
  matches=$(jq --arg title "premerge click PR #$pr" --slurpfile before "$state/before.json" '[.[] | select(.displayTitle == $title) | select(.databaseId as $id | all($before[0][]; .databaseId != $id))]' "$state/after.json")
  count=$(jq length <<<"$matches")
  [ "$count" -le 1 ] || { echo 'Ambiguous concurrent dispatches. Inspect the Actions run list; no run was assumed.' >&2; exit 1; }
  if [ "$count" -eq 1 ]; then run=$(jq -r '.[0].databaseId' <<<"$matches"); break; fi
  sleep "$delay"
done
[ -n "$run" ] || { echo 'Dispatched, but GitHub did not expose the run within the discovery window.' >&2; exit 1; }
printf 'Run URL: %s\n' "$(jq -r '.[0].url' <<<"$matches")"
result=0
gh run watch "$run" --repo "$repo" --exit-status --interval 30 || result=$?
artifact=$(gh api "repos/$repo/actions/runs/$run/artifacts" --jq '.artifacts[] | select(.name | test("^premerge-[0-9a-f]{40}$")) | .name')
if [ "$artifact" = "premerge-$sha" ]; then
  printf 'Artifact: %s\n' "$artifact"
else
  echo 'No unique premerge artifact was uploaded. See the run for the setup failure.' >&2
  result=1
fi
exit "$result"
