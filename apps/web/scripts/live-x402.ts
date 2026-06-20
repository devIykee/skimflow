/**
 * Headless Phase 4 live test — the agent x402 settle path.
 * Buyer (acting as an autonomous agent) signs a GatewayWalletBatched EIP-3009
 * authorization; we settle it via Circle's /v1/x402/settle (the same call the
 * agent route's withGateway middleware makes in live mode).
 *
 *   npx tsx scripts/live-x402.ts
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, getAddress, erc20Abi, formatUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

for (const line of readFileSync("../../.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const norm = (k: string) => (k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`) as `0x${string}`;
const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const USDC = getAddress(process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000");
const chain = { id: 5042002, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;

async function main() {
  const { settleViaCircle, batchingRequirements } = await import("../lib/reader-pay.js");
  const rel = await import("../lib/gateway-relayer.js");
  const pub = createPublicClient({ chain, transport: http(RPC) });

  const buyer = privateKeyToAccount(norm(process.env.BUYER_PRIVATE_KEY!));
  const creator = privateKeyToAccount(generatePrivateKey()).address; // fresh payee
  const amount = "50000"; // 0.05 USDC base units
  const req = batchingRequirements(amount, creator);
  const GW = getAddress((req.extra as { verifyingContract: string }).verifyingContract);

  console.log("agent/buyer", buyer.address);
  console.log("creator    ", creator, "(fresh — x402 pays full 0.05 here)");
  console.log("verifyingContract (GatewayWalletBatched)", GW);

  const now = Math.floor(Date.now() / 1000);
  const validAfter = "0";
  const validBefore = String(now + 7 * 24 * 3600 + 600);
  const nonce = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
  const authorization = { from: buyer.address, to: getAddress(creator), value: amount, validAfter, validBefore, nonce };

  const signature = await buyer.signTypedData({
    domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: GW },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { from: buyer.address, to: getAddress(creator), value: BigInt(amount), validAfter: 0n, validBefore: BigInt(validBefore), nonce },
  });
  console.log("\n[1] x402 authorization signed (GatewayWalletBatched). Settling via Circle /v1/x402/settle…");

  const creBefore = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(creator)] });
  const buyerGwBefore = await rel.gatewayBalance(buyer.address);

  const resource = {
    url: "https://skimflow.cite/read/demo-skill/agent-skills.md?block=1",
    description: "Unlock block 1",
    mimeType: "application/json",
  };
  const accepted = { ...req, resource: resource.url };
  let result: any;
  try {
    result = await settleViaCircle(
      { x402Version: 2, resource, accepted, payload: { authorization, signature } },
      accepted
    );
  } catch (e) {
    console.error("    settle threw:", String((e as Error).message));
    process.exit(1);
  }
  console.log("    settle response:", JSON.stringify(result));

  if (result?.success) {
    // small wait for chain visibility
    await new Promise((r) => setTimeout(r, 4000));
    const creAfter = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(creator)] });
    const buyerGwAfter = await rel.gatewayBalance(buyer.address);
    console.log("\n── RESULT ─────────────────────────────");
    console.log("creator USDC Δ :", "+" + formatUnits(creAfter - creBefore, 6), " expect ~0.05");
    console.log("buyer Gateway Δ:", formatUnits(buyerGwAfter - buyerGwBefore, 6), " expect ~ -0.05 (+fee)");
    const tx = String(result.transaction ?? "");
    if (tx) console.log("tx:", tx.startsWith("0x") ? `https://testnet.arcscan.app/tx/${tx}` : tx);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", String((e as Error)?.stack || e)); process.exit(1); });
