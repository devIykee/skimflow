#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Circle Agent Stack + Arc testnet bootstrap.
# Installs the Circle CLI and the Canteen ARC CLI, then prints the steps to
# create an agent wallet and fund it with TEST USDC.
#
#   bash scripts/circle-setup.sh
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "▸ Circle CLI (@circle-fin/cli) — agent wallets, x402 payments, USDC transfers"
if command -v circle >/dev/null 2>&1; then
  echo "  already installed: $(circle --version 2>/dev/null || echo '?')"
else
  npm install -g @circle-fin/cli
  echo "  installed: $(circle --version 2>/dev/null || echo '?')"
fi

echo
echo "▸ ARC CLI (Canteen-hosted Arc testnet RPC + agent context)"
if command -v uv >/dev/null 2>&1; then
  uv tool install git+https://github.com/the-canteen-dev/ARC-cli || true
else
  echo "  'uv' not found. Install uv first: https://docs.astral.sh/uv/  then run:"
  echo "    uv tool install git+https://github.com/the-canteen-dev/ARC-cli"
fi

echo
echo "▸ Official x402 batching SDK (buyer GatewayClient / seller BatchFacilitatorClient)"
echo "    npm install @circle-fin/x402-batching      # already an optional dep of apps/agent"

cat <<'EOF'

Next steps (see developers.circle.com/agent-stack/circle-cli/command-reference):

  1. Authenticate the Circle CLI with your API key:
       export CIRCLE_API_KEY=...           # your TESTNET key (rotate if ever shared)

  2. Create an agent wallet (buyer) and a seller wallet, then copy the
     addresses + private keys into .env:
       BUYER_ADDRESS=...   BUYER_PRIVATE_KEY=...
       SELLER_ADDRESS=...  SELLER_PRIVATE_KEY=...

  3. Fund the buyer with TEST USDC on Arc testnet (Circle faucet / CLI), then
     deposit into the Gateway unified balance:
       npm run circle --workspace apps/agent -- deposit 5
       npm run circle --workspace apps/agent -- balances

  4. Go live:  set PAYMENTS_MODE=live in .env, restart, and the buyer agent
     pays real test USDC through Circle Gateway:
       npm run circle --workspace apps/agent -- pay "<your x402 url>"

EOF
