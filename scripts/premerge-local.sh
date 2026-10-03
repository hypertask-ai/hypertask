#!/usr/bin/env bash
set -euo pipefail
# Never allow caller tracing to reveal disposable credentials.
set +x

usage() { echo 'Usage: scripts/premerge-local.sh [up|down]' >&2; }
if [ "$#" -gt 1 ]; then usage; exit 2; fi
case "${1:-up}" in up|down) action=${1:-up} ;; *) usage; exit 2 ;; esac
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
# Inherited production variables must not reach npm, Prisma, the seed or Next.
if [ "${PREMERGE_CLEAN_ENV:-}" != "$root" ]; then
  exec env -i PATH="$PATH" HOME="$HOME" PREMERGE_CLEAN_ENV="$root" bash "$root/scripts/premerge-local.sh" "$action"
fi
cd "$root"
umask 077
state="$root/e2e/smoke/.state/premerge-local"
mkdir -p "$state"
chmod 700 "$state"
exec 9>"$state/lock"
flock -n 9 || { echo 'Another premerge-local command is running in this worktree.' >&2; exit 1; }
key=$(printf '%s' "$root" | sha256sum | cut -c1-16)
prefix="ht-premerge-$key"

stop() {
  if [ -f "$state/server.pid" ]; then
    read -r pid started <"$state/server.pid"
    # Guard PID reuse, stripping Next's process title (which contains spaces).
    if [ -r "/proc/$pid/stat" ] && [ "$(sed 's/.*) //' "/proc/$pid/stat" | awk '{print $20}')" = "$started" ]; then
      kill -TERM -- "-$pid" 2>/dev/null || true
      for ((attempt=0; attempt<50; attempt++)); do
        kill -0 -- "-$pid" 2>/dev/null || break
        sleep 0.1
      done
      if kill -0 -- "-$pid" 2>/dev/null; then kill -KILL -- "-$pid" 2>/dev/null || true; fi
    fi
  fi
  for service in postgres redis soketi; do
    if docker container inspect "$prefix-$service" >/dev/null 2>&1; then
      docker rm -f -v "$prefix-$service" >/dev/null
    fi
  done
  rm -f "$state/server.pid" "$state/credentials.env" "$state/postgres.env" "$state/soketi.env" "$state/smoke-state.json" "$state/card-fixture.json" "$state/fixtures.out"
}
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker daemon is unavailable.' >&2; exit 1; }
if [ "$action" = down ]; then stop; exit 0; fi

for file in .env .env.local .env.production .env.production.local; do
  if [ -e "$file" ] || [ -L "$file" ]; then
    echo "Refusing $file: use a worktree without env files. No credentials were read." >&2
    exit 1
  fi
done
if [ -f "$state/server.pid" ] || [ -f "$state/credentials.env" ]; then
  echo 'Environment already exists. Run scripts/premerge-local.sh down first.' >&2
  exit 1
fi
for service in postgres redis soketi; do
  if docker container inspect "$prefix-$service" >/dev/null 2>&1; then
    echo 'Containers already exist. Run scripts/premerge-local.sh down first.' >&2
    exit 1
  fi
done
cleanup() {
  local result=$?
  trap - EXIT
  if [ "$result" -ne 0 ]; then
    stop
    echo "Local setup failed. Private logs: $state" >&4
  fi
  exit "$result"
}
exec 4>&2
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Logs can contain connection strings. Keep them private and never echo them.
exec 3>&1
exec >"$state/setup.log" 2>&1
if [ ! -d node_modules ]; then npm ci --prefer-offline --no-audit --no-fund; fi
npx --no-install prisma generate
secret() { node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"; }
pg_secret=$(secret)
pusher_secret=$(secret)
printf 'POSTGRES_DB=hypertask_smoke\nPOSTGRES_USER=browser_smoke\nPOSTGRES_PASSWORD=%s\n' "$pg_secret" >"$state/postgres.env"
printf 'SOKETI_DEFAULT_APP_ID=app-id\nSOKETI_DEFAULT_APP_KEY=app-key\nSOKETI_DEFAULT_APP_SECRET=%s\n' "$pusher_secret" >"$state/soketi.env"
docker run -d --name "$prefix-postgres" -p 127.0.0.1::5432 --env-file "$state/postgres.env" \
  --health-cmd 'pg_isready -U browser_smoke -d hypertask_smoke' --health-interval 2s --health-timeout 5s --health-retries 30 \
  postgres:16-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825
docker run -d --name "$prefix-redis" -p 127.0.0.1::6379 \
  --health-cmd 'redis-cli ping' --health-interval 2s --health-timeout 5s --health-retries 30 \
  redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf
docker run -d --name "$prefix-soketi" -p 127.0.0.1::6001 --env-file "$state/soketi.env" \
  --health-cmd 'wget --no-verbose --tries=1 --spider http://127.0.0.1:6001' --health-interval 2s --health-timeout 5s --health-retries 30 \
  quay.io/soketi/soketi:1.6-16-alpine@sha256:5e45fe1adbf2d4ef8022d0126a3c7e4371b7b08f35784b76a2dc353954ee885c
for service in postgres redis soketi; do
  for ((attempt=0; attempt<90; attempt++)); do
    health=$(docker inspect --format '{{.State.Health.Status}}' "$prefix-$service")
    [ "$health" != unhealthy ] || exit 1
    [ "$health" != healthy ] || break
    sleep 1
  done
  [ "$health" = healthy ] || exit 1
done
port() { docker port "$prefix-$1" "$2/tcp" | cut -d: -f2; }
pg_port=$(port postgres 5432)
redis_port=$(port redis 6379)
pusher_port=$(port soketi 6001)
app_port=$(node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
url="http://127.0.0.1:$app_port"
{
  printf 'DATABASE_URL=postgresql://browser_smoke:%s@127.0.0.1:%s/hypertask_smoke\n' "$pg_secret" "$pg_port"
  printf 'REDIS_URL=redis://127.0.0.1:%s\n' "$redis_port"
  printf 'SESSION_SECRET=%s\nJWT_SECRET=%s\nBETTER_AUTH_SECRET=%s\n' "$(secret)" "$(secret)" "$(secret)"
  printf 'BETTER_AUTH_URL=%s\nQSTASH_CALLBACK_BASE_URL=%s\nQSTASH_AUTO_REGISTER_SWEEP=false\n' "$url" "$url"
  printf 'NEXT_PUBLIC_PUSHER_KEY=app-key\nNEXT_PUBLIC_PUSHER_HOST=127.0.0.1\nNEXT_PUBLIC_PUSHER_PORT=%s\nNEXT_PUBLIC_PUSHER_USE_TLS=false\nNEXT_PUBLIC_PUSHER_CLUSTER=mt1\n' "$pusher_port"
  printf 'PUSHER_APP_ID=app-id\nPUSHER_KEY=app-key\nPUSHER_SECRET=%s\nPUSHER_HOST=127.0.0.1\nPUSHER_PORT=%s\nPUSHER_USE_TLS=false\nPUSHER_CLUSTER=mt1\n' "$pusher_secret" "$pusher_port"
} >"$state/credentials.env"
chmod 600 "$state/credentials.env"
set -a
# shellcheck disable=SC1091
source "$state/credentials.env"
set +a
export BROWSER_SMOKE_STATE_FILE="$state/smoke-state.json" GITHUB_OUTPUT="$state/fixtures.out" NEXT_TELEMETRY_DISABLED=1
npx --no-install prisma migrate deploy
node scripts/seed-browser-smoke.mjs
npx --no-install next build --webpack
setsid node "$root/node_modules/next/dist/bin/next" start -H 127.0.0.1 -p "$app_port" >"$state/server.log" 2>&1 9>&- 3>&- &
pid=$!
printf '%s %s\n' "$pid" "$(sed 's/.*) //' "/proc/$pid/stat" | awk '{print $20}')" >"$state/server.pid"
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  kill -0 "$pid" 2>/dev/null || exit 1
  if curl -fsS --max-time 2 -o /dev/null "$url/login"; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || exit 1
board_path=$(sed -n 's/^board_path=//p' "$state/fixtures.out")
[ -n "$board_path" ] || exit 1
account=$(node -e 'const s=require(process.argv[1]);console.log(JSON.parse(decodeURIComponent(s.cookies.find(c=>c.name==="nookies_user").value)).id)' "$BROWSER_SMOKE_STATE_FILE")
flags=$(node -e 'const {modes}=require("./e2e/smoke/production-flag-modes.json");console.log(Object.entries(modes).map(([k,v])=>k+"="+v).join(", "))')
printf 'Build URL: %s\nBoard URL: %s%s\nStorage state: %s\nCommit: %s\nAccount: %s (disposable board owner)\nFlags: %s (checked-in snapshot, confirm live modes)\nBoard: %s%s\nBuild: %s\n' \
  "$url" "$url" "$board_path" "$BROWSER_SMOKE_STATE_FILE" "$(git rev-parse HEAD)" "$account" "$flags" "$url" "$board_path" "$url" >&3
