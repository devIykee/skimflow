#!/usr/bin/env node
/**
 * Circle Gateway buyer CLI — drives the official @circle-fin/x402-batching
 * GatewayClient against the real Arc testnet. Requires a funded buyer wallet
 * (BUYER_PRIVATE_KEY) and PAYMENTS_MODE=live.
 *
 *   npm run circle -- balances
 *   npm run circle -- deposit 1
 *   npm run circle -- pay https://your-deployment/api/content/c_abc?lineStart=4&lineEnd=44
 *
 * Provision the wallet + test USDC first with the Circle CLI:
 *   npm install -g @circle-fin/cli
 *   circle --version
 *   # see https://developers.circle.com/agent-stack/circle-cli/command-reference
 */
import { getCircleBuyer, circleNativeEnabled } from "./circle-gateway.js";

// The Circle SDK returns on-chain amounts as BigInt; JSON.stringify can't
// serialize those, so render them as plain decimal strings.
const bigintSafe = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;
const pretty = (v: unknown) => JSON.stringify(v, bigintSafe, 2);

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!circleNativeEnabled()) {
    console.error("Set PAYMENTS_MODE=live and BUYER_PRIVATE_KEY (funded Arc testnet wallet) first.");
    process.exit(1);
  }
  const client = await getCircleBuyer();

  switch (cmd) {
    case "balances": {
      console.log(pretty(await client.getBalances()));
      break;
    }
    case "deposit": {
      if (!arg) throw new Error("usage: circle deposit <usdc-amount>");
      console.log(pretty(await client.deposit(arg)));
      break;
    }
    case "withdraw": {
      if (!arg) throw new Error("usage: circle withdraw <usdc-amount>");
      console.log(pretty(await client.withdraw(arg)));
      break;
    }
    case "pay": {
      if (!arg) throw new Error("usage: circle pay <x402-url>");
      const { data, status } = await client.pay(arg);
      console.log("status:", status);
      console.log(typeof data === "string" ? data : pretty(data));
      break;
    }
    default:
      console.log("commands: balances | deposit <amt> | withdraw <amt> | pay <url>");
  }
}

main().catch((e) => {
  console.error("circle-pay error:", e?.message ?? e);
  process.exit(1);
});
