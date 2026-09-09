#!/usr/bin/env bash
set -euo pipefail

candidate_root=${1:?candidate checkout is required}
trusted_root=${2:?trusted checkout is required}
[ -d "$candidate_root" ] || { echo "Candidate checkout does not exist." >&2; exit 1; }
[ -d "$trusted_root/scripts" ] || { echo "Trusted scripts do not exist." >&2; exit 1; }
candidate_root=$(cd "$candidate_root" && pwd -P)
trusted_root=$(cd "$trusted_root" && pwd -P)

# Docker cannot create nested mount targets beneath the read-only /app bind.
for candidate_mount in node_modules .next; do
  mount_target="$candidate_root/$candidate_mount"
  if [ -L "$mount_target" ] || { [ -e "$mount_target" ] && [ ! -d "$mount_target" ]; }; then
    echo "Candidate mount target must be a directory: $candidate_mount" >&2
    exit 1
  fi
  mkdir -p "$mount_target"
done

next_env_target="$candidate_root/next-env.d.ts"
if [ -L "$next_env_target" ] || { [ -e "$next_env_target" ] && [ ! -f "$next_env_target" ]; }; then
  echo "Candidate next-env.d.ts mount target must be a regular file." >&2
  exit 1
fi
next_env_target_created=false
scratch=$(mktemp -d "${RUNNER_TEMP:-/tmp}/ht-app-smoke.XXXXXX")
next_env="$scratch/next-env.d.ts"
: >"$next_env"
# The builder may run under a remapped uid. Only this file is writable outside its private scratch directory.
chmod 0666 "$next_env"
invocation_key=${scratch##*.}
run_key=$(printf '%s-%s-%s' "${GITHUB_RUN_ID:-$$}" "${GITHUB_RUN_ATTEMPT:-1}" "$invocation_key" | tr -cd 'a-zA-Z0-9_-' | tr '[:upper:]' '[:lower:]')
network="ht-smoke-net-$run_key"
egress_network="ht-smoke-egress-$run_key"
database="ht-smoke-db-$run_key"
app="ht-smoke-app-$run_key"
install="ht-smoke-install-$run_key"
rebuild="ht-smoke-rebuild-$run_key"
engine_fetch="ht-smoke-engine-fetch-$run_key"
posthog_fetch="ht-smoke-posthog-fetch-$run_key"
registry_proxy="ht-smoke-registry-proxy-$run_key"
dependencies="ht-smoke-dependencies-$run_key"
prepare="ht-smoke-prepare-$run_key"
seed="ht-smoke-seed-$run_key"
builder="ht-smoke-builder-$run_key"
probe="ht-smoke-probe-$run_key"
harness="ht-smoke-harness-$run_key"
mock="ht-smoke-mock-$run_key"
volume_keeper="ht-smoke-volume-keeper-$run_key"
build="ht-smoke-build-$run_key"
state="ht-smoke-state-$run_key"
runtime_image="ht-smoke-runtime-$run_key"

cleanup() {
  result=${1:-$?}
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ]; then docker logs "$app" 2>/dev/null | tail -200 || true; fi
  docker rm -f "$app" "$database" "$install" "$rebuild" "$engine_fetch" "$posthog_fetch" "$registry_proxy" "$prepare" "$seed" "$builder" "$probe" "$harness" "$mock" "$volume_keeper" >/dev/null 2>&1 || true
  docker network rm "$network" "$egress_network" >/dev/null 2>&1 || true
  docker volume rm "$build" "$state" "$dependencies" >/dev/null 2>&1 || true
  docker image rm "$runtime_image" >/dev/null 2>&1 || true
  if [ "$next_env_target_created" = true ]; then rm -f -- "$next_env_target"; fi
  rm -rf "$scratch"
  exit "$result"
}
trap cleanup EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

if [ ! -e "$next_env_target" ]; then
  : >"$next_env_target"
  next_env_target_created=true
fi

docker network create --internal "$network" >/dev/null
docker network create "$egress_network" >/dev/null
docker volume create --driver local --opt type=tmpfs --opt device=tmpfs --opt o=size=5g "$build" >/dev/null
docker volume create --driver local --opt type=tmpfs --opt device=tmpfs --opt o=size=16m "$state" >/dev/null
docker volume create --driver local --opt type=tmpfs --opt device=tmpfs --opt o=size=4g "$dependencies" >/dev/null
docker build --pull=false -t "$runtime_image" \
  -f "$trusted_root/scripts/app-smoke.Dockerfile" "$trusted_root/scripts"

# Keep the bounded tmpfs volumes mounted so their contents survive between one-shot containers.
docker run -d --name "$volume_keeper" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --pids-limit 16 \
  --memory 32m \
  --tmpfs /tmp:rw,nosuid,nodev,size=1m \
  -v "$build:/build" \
  -v "$state:/state" \
  -v "$dependencies:/dependencies" \
  "$runtime_image" sleep infinity >/dev/null

use_trusted_dependencies=false
dependencies_mount=$dependencies
if [ "${CORE_SMOKE_TRUSTED_DEPENDENCIES:-false}" = true ] && [ -d "$trusted_root/node_modules" ]; then
  inputs_match=true
  for trusted_input in package.json package-lock.json .npmrc prisma.config.ts src/prisma; do
    if [ ! -e "$candidate_root/$trusted_input" ] && [ ! -e "$trusted_root/$trusted_input" ]; then
      continue
    fi
    if ! diff -qr -- "$candidate_root/$trusted_input" "$trusted_root/$trusted_input" >/dev/null; then
      inputs_match=false
      break
    fi
  done
  if [ "$inputs_match" = true ]; then
    use_trusted_dependencies=true
    dependencies_mount=$trusted_root/node_modules
  fi
fi

if [ "$use_trusted_dependencies" = false ]; then
  proxy_token=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  docker run -d --name "$registry_proxy" --network "$egress_network" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 128m \
    --tmpfs /tmp:rw,nosuid,nodev,size=16m \
    -e SMOKE_PROXY_HOST=0.0.0.0 \
    -e SMOKE_PROXY_TOKEN="$proxy_token" \
    -v "$trusted_root/scripts/npm-registry-smoke-proxy.mjs:/trusted/npm-registry-smoke-proxy.mjs:ro" \
    "$runtime_image" node /trusted/npm-registry-smoke-proxy.mjs >/dev/null
  docker network connect --alias registry-proxy "$network" "$registry_proxy"
  for attempt in $(seq 1 20); do
    if docker exec "$registry_proxy" node -e \
      "require('node:net').connect(3128, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"; then
      break
    fi
    [ "$attempt" -lt 20 ] || { echo "npm registry proxy did not become ready." >&2; exit 1; }
    sleep 1
  done

  docker run --rm --name "$install" --network "$network" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --read-only \
    --pids-limit 2048 \
    --memory 12g \
    --cpus 4 \
    --tmpfs /tmp:rw,nosuid,nodev,size=1g \
    -v "$candidate_root:/app:ro" \
    -v "$dependencies:/app/node_modules" \
    -e HOME=/tmp \
    -e NPM_CONFIG_CACHE=/tmp/npm-cache \
    -e HTTPS_PROXY=http://smoke:"$proxy_token"@registry-proxy:3128 \
    -e HTTP_PROXY=http://smoke:"$proxy_token"@registry-proxy:3128 \
    -e NO_PROXY= \
    -w /app \
    "$runtime_image" bash -euo pipefail -c '
      npm ci --ignore-scripts --no-audit --no-fund \
        --registry=https://registry.npmjs.org/ \
        --proxy="$HTTP_PROXY" \
        --https-proxy="$HTTPS_PROXY"
    '
  docker rm -f "$registry_proxy" >/dev/null

  docker run --rm --name "$engine_fetch" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --read-only \
    --pids-limit 64 \
    --memory 256m \
    --tmpfs /tmp:rw,nosuid,nodev,size=128m \
    -v "$candidate_root:/app:ro" \
    -v "$dependencies:/app/node_modules" \
    -v "$trusted_root/scripts/fetch-prisma-smoke-engine.mjs:/trusted/fetch-prisma-smoke-engine.mjs:ro" \
    -w /app \
    "$runtime_image" node /trusted/fetch-prisma-smoke-engine.mjs

  # @posthog/cli's postinstall downloads its binary from github.com, which the
  # isolated network blocks, and candidate install scripts must not run with
  # egress. Run the trusted fetch script instead so npm rebuild finds the
  # binary already installed and skips its own download.
  docker run --rm --name "$posthog_fetch" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --read-only \
    --pids-limit 64 \
    --memory 256m \
    --tmpfs /tmp:rw,nosuid,nodev,size=128m \
    -v "$candidate_root:/app:ro" \
    -v "$dependencies:/app/node_modules" \
    -v "$trusted_root/scripts/fetch-posthog-smoke-binary.mjs:/trusted/fetch-posthog-smoke-binary.mjs:ro" \
    -w /app \
    "$runtime_image" node /trusted/fetch-posthog-smoke-binary.mjs

  docker run --rm --name "$rebuild" --network "$network" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --read-only \
    --pids-limit 2048 \
    --memory 12g \
    --cpus 4 \
    --tmpfs /tmp:rw,nosuid,nodev,size=1g \
    -v "$candidate_root:/app:ro" \
    -v "$dependencies:/app/node_modules" \
    -e HOME=/tmp \
    -e NPM_CONFIG_CACHE=/tmp/npm-cache \
    -w /app \
    "$runtime_image" bash -euo pipefail -c '
      timeout --signal=KILL 5m npm rebuild
      timeout --signal=KILL 2m env DATABASE_URL=postgresql://core_smoke:core_smoke@database:5432/hypertask_smoke ./node_modules/.bin/prisma generate
    '
fi

runtime=(
  --cap-drop ALL
  --security-opt no-new-privileges
  --read-only
  --pids-limit 2048
  --memory 12g
  --cpus 4
  --tmpfs /tmp:rw,nosuid,nodev,size=1g
  -v "$candidate_root:/app:ro"
  -v "$dependencies_mount:/app/node_modules:ro"
  -v "$build:/app/.next"
  -w /app
)

trusted_runtime=(
  --cap-drop ALL
  --security-opt no-new-privileges
  --read-only
  --pids-limit 512
  --memory 2g
  --cpus 2
  --tmpfs /tmp:rw,nosuid,nodev,size=128m
  -v "$trusted_root:/trusted:ro"
  -w /trusted
)

postgres_admin_password=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
docker run -d --name "$database" --network "$network" \
  --pids-limit 256 \
  --memory 1g \
  --cpus 2 \
  --security-opt no-new-privileges \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1g \
  -e POSTGRES_DB=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$postgres_admin_password" \
  postgres:16-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825 >/dev/null

for attempt in $(seq 1 30); do
  if docker logs "$database" 2>&1 | grep -q 'PostgreSQL init process complete; ready for start up.' &&
    docker exec "$database" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  [ "$attempt" -lt 30 ] || { echo "PostgreSQL did not become ready." >&2; exit 1; }
  sleep 1
done

docker exec "$database" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE core_smoke LOGIN PASSWORD 'core_smoke' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION" \
  -c "CREATE DATABASE hypertask_smoke OWNER core_smoke"

common_env=(
  -e DATABASE_URL=postgresql://core_smoke:core_smoke@"$database":5432/hypertask_smoke
  -e SESSION_SECRET=core-actions-"$run_key"
  -e NEXT_TELEMETRY_DISABLED=1
  -e GITHUB_ACTIONS="${GITHUB_ACTIONS:-false}"
  -e QSTASH_CALLBACK_BASE_URL=http://"$app":3100
  -e QSTASH_AUTO_REGISTER_SWEEP=false
  -e TURBOPUFFER_BASE_URL=http://"$mock":3200
  -e BUILD_ID="${GITHUB_SHA:-smoke}"
)

docker run --rm --name "$prepare" --network "$network" "${runtime[@]}" "${common_env[@]}" \
  "$runtime_image" timeout --signal=KILL 2m ./node_modules/.bin/prisma migrate deploy

docker run --rm --name "$seed" --network "$network" "${trusted_runtime[@]}" "${common_env[@]}" \
  -e CORE_SMOKE_APP_ROOT=/trusted \
  -e CORE_SMOKE_ENV_FILE=/state/smoke.env \
  -v "$state:/state" \
  "$runtime_image" timeout --signal=KILL 1m node /trusted/scripts/seed-core-actions-smoke.mjs

docker run --rm --name "$probe" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -v "$state:/state:ro" \
  "$runtime_image" cat /state/smoke.env >"$scratch/smoke.env"
chmod 600 "$scratch/smoke.env"

docker run -d --name "$mock" --network "$network" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --pids-limit 64 \
  --memory 128m \
  --env-file "$scratch/smoke.env" \
  -v "$trusted_root/scripts/turbopuffer-smoke-mock.mjs:/trusted/turbopuffer-smoke-mock.mjs:ro" \
  "$runtime_image" node /trusted/turbopuffer-smoke-mock.mjs >/dev/null

docker run --rm --name "$builder" --network "$network" "${runtime[@]}" "${common_env[@]}" \
  --env-file "$scratch/smoke.env" \
  -e NODE_OPTIONS=--max-old-space-size=8192 \
  -e CORE_APP_SMOKE=true \
  -e NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/trusted/next-font-smoke-mock.cjs \
  -v "$next_env:/app/next-env.d.ts:rw" \
  -v "$trusted_root/scripts:/trusted:ro" \
  "$runtime_image" timeout --signal=KILL 10m node node_modules/next/dist/bin/next build --webpack

docker run -d --name "$app" --network "$network" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --log-opt max-size=10m \
  --log-opt max-file=1 \
  --pids-limit 1024 \
  --memory 8g \
  --cpus 4 \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  -v "$candidate_root:/app:ro" \
  -v "$dependencies_mount:/app/node_modules:ro" \
  -v "$build:/app/.next:ro" \
  -w /app \
  "${common_env[@]}" \
  --env-file "$scratch/smoke.env" \
  "$runtime_image" node node_modules/next/dist/bin/next start -p 3100 >/dev/null

deadline=$((SECONDS + 60))
app_ready=false
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! docker inspect -f '{{.State.Running}}' "$app" 2>/dev/null | grep -qx true; then
    echo "Next.js exited before becoming ready." >&2
    exit 1
  fi
  if docker run --rm --name "$probe" --network "$network" "$runtime_image" \
    node -e "fetch('http://$app:3100', { redirect: 'manual', signal: AbortSignal.timeout(5000) }).then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"; then
    app_ready=true
    break
  fi
  sleep 1
done
[ "$app_ready" = true ] || { echo "Next.js did not become ready within 60 seconds." >&2; exit 1; }

timeout --signal=KILL 2m docker run --rm --name "$harness" --network "$network" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --pids-limit 128 \
  --memory 256m \
  --tmpfs /tmp:rw,nosuid,nodev,size=16m \
  --env-file "$scratch/smoke.env" \
  -e CORE_SMOKE_BASE_URL=http://"$app":3100 \
  -e CORE_SMOKE_RUN_ID="$run_key" \
  -e CORE_SMOKE_APP_ROOT=/trusted \
  -e CORE_SMOKE_TRUSTED_ROOT=/trusted \
  -v "$trusted_root:/trusted:ro" \
  "$runtime_image" node /trusted/scripts/run-shared-core-actions-smoke.mjs
