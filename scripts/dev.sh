#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# LinePay Cite — one command to set up AND run everything.
#
#   npm run up                  # install deps, ensure DB, migrate, seed, start
#   npm run up:fresh            # also reset the local Docker DB + .next first
#   bash scripts/dev.sh --traffic      # also generate demo agent unlocks (off by default)
#   bash scripts/dev.sh --no-seed      # just start the server
#   PORT=3001 npm run up        # use a different port
#
# Zero-config for forkers: if DATABASE_URL is not set anywhere, a local
# Postgres is started via Docker automatically. If you already have a
# DATABASE_URL (e.g. Supabase), it is used and Docker is skipped.
#
# Leaves the dev server in the foreground. Press Ctrl-C to stop it.
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

# Demo traffic is OFF by default: it writes simulate-mode unlock rows to the DB,
# which would pollute a shared/production database. Opt in with --traffic.
FRESH=0; SEED=1; TRAFFIC=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --traffic) TRAFFIC=1 ;;
    --no-traffic) TRAFFIC=0 ;;  # accepted for back-compat; this is now the default
    --no-seed) SEED=0; TRAFFIC=0 ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

PORT="${PORT:-3000}"
DEV_LOG="/tmp/linepay-dev.log"
PG_CONTAINER="linepay-postgres"
WEB_ENV="apps/web/.env.local"

echo "▸ LinePay Cite — one-command start"

# ── 1. Env: ONE canonical file at repo-root .env. apps/web/.env.local is a
#         symlink to it, so Next.js (web), Hardhat (../.env), and the scripts
#         all read the same single file. ──────────────────────────────────────
[ -f .env ] || cp .env.example .env
if [ -L "$WEB_ENV" ]; then
  :  # already the symlink we want
elif [ -f "$WEB_ENV" ]; then
  # A stray real file from before the single-file migration — preserve, relink.
  echo "  ⚠ $WEB_ENV is a real file; backing up to ${WEB_ENV}.bak and linking to root .env"
  mv "$WEB_ENV" "${WEB_ENV}.bak"
  ln -s ../../.env "$WEB_ENV"
else
  ln -s ../../.env "$WEB_ENV"
  echo "  linked $WEB_ENV → root .env (single env file)"
fi

# Read a var from process env, then apps/web/.env.local, then .env.
get_env() {
  local name="$1"
  if [ -n "${!name:-}" ]; then echo "${!name}"; return; fi
  local f v
  for f in "$WEB_ENV" .env; do
    [ -f "$f" ] || continue
    v=$(grep -E "^${name}=" "$f" | head -1 | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//')
    if [ -n "$v" ]; then echo "$v"; return; fi
  done
  echo ""
}
ensure_line() { # file key value — append only if key absent
  local f="$1" k="$2" v="$3"; touch "$f"
  grep -qE "^${k}=" "$f" || echo "${k}=${v}" >> "$f"
}

# ── 2. Dependencies ──────────────────────────────────────────────────────────
if [ ! -d node_modules ] || [ ! -d node_modules/next ] || [ ! -d node_modules/pg ] || [ ! -d node_modules/next-auth ]; then
  echo "▸ installing dependencies…"
  npm install || npm install --legacy-peer-deps
fi

# ── 3. Database: use DATABASE_URL if set, else provision local Postgres ─────
DB_URL="$(get_env DATABASE_URL)"
if [ "$FRESH" = "1" ] && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${PG_CONTAINER}$"; then
  echo "▸ --fresh: removing local Postgres container"
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  DB_URL=""  # force re-provision
fi

if [ -z "$DB_URL" ]; then
  if command -v docker >/dev/null 2>&1; then
    echo "▸ no DATABASE_URL set — starting local Postgres via Docker…"
    if docker ps -a --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
      docker start "$PG_CONTAINER" >/dev/null
    else
      docker run -d --name "$PG_CONTAINER" \
        -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=linepay \
        -p 5432:5432 postgres:16 >/dev/null
    fi
    echo -n "  waiting for Postgres "
    for i in $(seq 1 30); do
      if docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then echo " ready"; break; fi
      echo -n "."; sleep 1
      [ "$i" -eq 30 ] && { echo " timeout"; exit 1; }
    done
    DB_URL="postgres://postgres:postgres@localhost:5432/linepay"
    # Single canonical file; $WEB_ENV is a symlink to it.
    ensure_line .env DATABASE_URL "$DB_URL"
    ensure_line .env PGSSL "disable"
  else
    echo "✗ DATABASE_URL is not set and Docker is unavailable."
    echo "  Set DATABASE_URL in $WEB_ENV (e.g. a Supabase Session pooler URL) and re-run."
    exit 1
  fi
fi
export DATABASE_URL="$DB_URL"

# ── 4. Migrate + seed (direct to Postgres; no server needed) ────────────────
echo "▸ running migrations…"
( cd apps/web && npm run db:migrate )
if [ "$SEED" = "1" ]; then
  echo "▸ seeding sample content (skips if already seeded)…"
  ( cd apps/web && npm run db:seed )
fi

# Clear a stale production build so `next dev` doesn't trip on it.
[ "$FRESH" = "1" ] && rm -rf apps/web/.next
[ -f apps/web/.next/BUILD_ID ] && rm -rf apps/web/.next

# ── 5. Stop a previous instance from this script ────────────────────────────
if [ -f /tmp/linepay-dev.pid ] && kill -0 "$(cat /tmp/linepay-dev.pid)" 2>/dev/null; then
  kill "$(cat /tmp/linepay-dev.pid)" 2>/dev/null || true; sleep 1
fi

# ── 6. Start the dev server ──────────────────────────────────────────────────
# Preload that pins outbound fetch to IPv4 (Node/undici won't fall back from a
# dead IPv6 route → OAuth "fetch failed" on hosts like WSL2). See the file's
# header. Disable with UNDICI_FORCE_IPV4=0. Must be a preload, not Next's
# instrumentation.ts (importing undici there breaks the edge bundle).
PRELOAD="$(node -p "require('url').pathToFileURL(require('path').resolve('apps/web/scripts/force-ipv4.mjs')).href")"
DEV_NODE_OPTIONS="--import \"$PRELOAD\"${NODE_OPTIONS:+ $NODE_OPTIONS}"
echo "▸ starting Next.js dev server…"
( cd apps/web && PORT="$PORT" NODE_OPTIONS="$DEV_NODE_OPTIONS" npm run dev ) >"$DEV_LOG" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > /tmp/linepay-dev.pid
trap 'echo; echo "▸ stopping dev server ($DEV_PID)"; kill "$DEV_PID" 2>/dev/null || true; rm -f /tmp/linepay-dev.pid' EXIT INT TERM

# ── 7. Wait until it answers ────────────────────────────────────────────────
echo -n "  waiting for the server "
URL=""
for i in $(seq 1 90); do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo " — server exited early. Last log lines:"; tail -25 "$DEV_LOG"; exit 1
  fi
  URL="$(grep -oE 'http://localhost:[0-9]+' "$DEV_LOG" | head -1 || true)"
  [ -z "$URL" ] && URL="http://localhost:$PORT"
  if curl -sf "$URL/" >/dev/null 2>&1; then echo " up at $URL"; break; fi
  echo -n "."; sleep 1
  [ "$i" -eq 90 ] && { echo " timeout — see $DEV_LOG"; tail -25 "$DEV_LOG"; exit 1; }
done
export APP_BASE_URL="$URL"

# ── 8. Demo traffic (agent unlocks) so dashboards are populated ─────────────
if [ "$TRAFFIC" = "1" ]; then
  echo "▸ generating demo traffic…"
  npm run demo:traffic || true
fi

cat <<EOF

✅ Running. (Ctrl-C here stops the server.)
   • Landing        $URL
   • For You feed   $URL/for-you
   • Creator portal $URL/dashboard      (sign in with Google/GitHub)
   • Admin          $URL/admin          (sign in as ADMIN_EMAIL)
   • Docs           $URL/docs

   Run the buyer agent in another terminal (server stays up here):
     npm run agent -- --url $URL --slug solidity-security-skills --simulate

   Server log: $DEV_LOG
EOF

wait "$DEV_PID"
