#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# LinePay Cite — one-command setup.
#   bash scripts/setup.sh
# Installs deps, prepares env, starts the dev server, seeds sample content,
# and leaves the server running. Works fully in SIMULATE mode (no keys needed).
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ LinePay Cite setup"

# 1. Env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  created .env (simulate mode — edit for Arc/Circle live mode)"
fi
# Next.js reads apps/web/.env.local for the web app.
cp .env apps/web/.env.local 2>/dev/null || true

# 2. Install (workspaces install everything)
echo "▸ installing dependencies (npm workspaces)…"
npm install

# 3. Start the dev server in the background
echo "▸ starting dev server…"
( npm run dev >/tmp/linepay-dev.log 2>&1 & echo $! > /tmp/linepay-dev.pid )
DEV_PID="$(cat /tmp/linepay-dev.pid)"
trap 'echo; echo "▸ stopping dev server ($DEV_PID)"; kill "$DEV_PID" 2>/dev/null || true' EXIT

# 4. Wait for it to answer
echo -n "  waiting for http://localhost:3000 "
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/api/catalog >/dev/null 2>&1; then echo " up"; break; fi
  echo -n "."; sleep 1
  if [ "$i" -eq 60 ]; then echo " timeout — see /tmp/linepay-dev.log"; exit 1; fi
done

# 5. Seed
echo "▸ seeding sample creators + content…"
npm run seed

# 6. Generate demo traction (human + agent payments) so the dashboards are live
echo "▸ generating demo traffic (human reads + agent runs)…"
npm run demo:traffic || true

cat <<EOF

✅ Ready.
   • Landing       http://localhost:3000
   • Read & pay     http://localhost:3000/read
   • Creator portal http://localhost:3000/creators
   • Agent demo     http://localhost:3000/demo

   Try the agent from the CLI in another terminal:
     npm run agent -- "How do nanopayments change online writing?"
     npm run agent -- "continue reading The Clockwork Archive"

   (Server log: /tmp/linepay-dev.log — Ctrl-C here stops the server.)
EOF

wait "$DEV_PID"
