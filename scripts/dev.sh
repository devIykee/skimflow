#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# LinePay Cite — start everything in one go (no terminal hopping).
#
#   bash scripts/dev.sh                 # start, seed if empty, demo traffic
#   bash scripts/dev.sh --fresh         # wipe DB + .next first (clean slate)
#   bash scripts/dev.sh --no-traffic    # start + seed, skip demo traffic
#   bash scripts/dev.sh --no-seed       # just start the server
#   PORT=3001 bash scripts/dev.sh       # use a different port
#
# Leaves the dev server running in the foreground. Press Ctrl-C to stop it.
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

FRESH=0; SEED=1; TRAFFIC=1
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --no-traffic) TRAFFIC=0 ;;
    --no-seed) SEED=0; TRAFFIC=0 ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

PORT="${PORT:-3000}"
DEV_LOG="/tmp/linepay-dev.log"

echo "▸ LinePay Cite — one-command start"

# 1. Env files
if [ ! -f .env ]; then cp .env.example .env; echo "  created .env (simulate mode)"; fi
cp .env apps/web/.env.local 2>/dev/null || true

# 2. Dependencies — install if missing OR out of date (new wagmi/rainbowkit deps)
if [ ! -d node_modules ] || [ ! -d node_modules/next ] || [ ! -d node_modules/wagmi ] || [ ! -d node_modules/@rainbow-me/rainbowkit ]; then
  echo "▸ installing dependencies…"
  npm install || npm install --legacy-peer-deps
fi

# 3. Optional clean slate
if [ "$FRESH" = "1" ]; then
  echo "▸ --fresh: wiping DB + .next"
  rm -f linepay.db linepay.db-* apps/web/linepay.db apps/web/linepay.db-*
  rm -rf apps/web/.next
fi
# Always clear a stale *production* build so `next dev` doesn't trip on it.
if [ -f apps/web/.next/BUILD_ID ]; then rm -rf apps/web/.next; fi

# 4. Stop a previous instance started by this script
if [ -f /tmp/linepay-dev.pid ] && kill -0 "$(cat /tmp/linepay-dev.pid)" 2>/dev/null; then
  echo "▸ stopping previous dev server ($(cat /tmp/linepay-dev.pid))"
  kill "$(cat /tmp/linepay-dev.pid)" 2>/dev/null || true
  sleep 1
fi

# 5. Start the dev server
echo "▸ starting Next.js dev server…"
( cd apps/web && PORT="$PORT" npm run dev ) >"$DEV_LOG" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > /tmp/linepay-dev.pid
trap 'echo; echo "▸ stopping dev server ($DEV_PID)"; kill "$DEV_PID" 2>/dev/null || true; rm -f /tmp/linepay-dev.pid' EXIT INT TERM

# 6. Wait until it actually answers (and learn the real port from the log)
echo -n "  waiting for the server "
URL=""
for i in $(seq 1 90); do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo " — server exited early. Last log lines:"; tail -20 "$DEV_LOG"; exit 1
  fi
  URL="$(grep -oE 'http://localhost:[0-9]+' "$DEV_LOG" | head -1 || true)"
  [ -z "$URL" ] && URL="http://localhost:$PORT"
  if curl -sf "$URL/api/catalog" >/dev/null 2>&1; then echo " up at $URL"; break; fi
  echo -n "."; sleep 1
  if [ "$i" -eq 90 ]; then echo " timeout — see $DEV_LOG"; tail -20 "$DEV_LOG"; exit 1; fi
done
export APP_BASE_URL="$URL"

# 7. Seed sample content only if the catalog is empty (re-runs won't duplicate)
if [ "$SEED" = "1" ]; then
  if curl -s "$URL/api/catalog" | grep -q '"id"'; then
    echo "▸ catalog already has content — skipping seed"
  else
    echo "▸ seeding sample creators + content…"
    npm run seed
  fi
fi

# 8. Demo traffic (human + agent payments) so dashboards are live
if [ "$TRAFFIC" = "1" ]; then
  echo "▸ generating demo traffic…"
  npm run demo:traffic || true
fi

cat <<EOF

✅ Running. (Ctrl-C here stops the server.)
   • Landing        $URL
   • Read / pay     $URL/read
   • Marketplace    $URL/market
   • Creator portal $URL/creators
   • Agent demo     $URL/demo
   • Creator docs   $URL/docs

   Run the buyer agent in another terminal (server stays up here):
     npm run agent -- "How do nanopayments change online writing?"

   Server log: $DEV_LOG
EOF

# 9. Hand the terminal to the server (foreground)
wait "$DEV_PID"
